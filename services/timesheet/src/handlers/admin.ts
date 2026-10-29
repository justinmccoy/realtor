import { z } from "zod";
import {
  adminAuth,
  apiHandler,
  dispatch,
  nowIso,
  publishAdminAction,
  publishEvents,
  type AdminAuth
} from "@jj/lambda-kit";
import {
  EVENT_SOURCES,
  hoursCreateSchema,
  hoursUpdateSchema,
  pageQuerySchema,
  paginateOffset,
  payMonthSchema,
  timerPutSchema,
  type DomainEventType,
  type HoursEntry
} from "@jj/shared";
import {
  dateOf,
  entriesInMonth,
  fmtMinutes,
  sortEntries,
  timerMinutes
} from "../domain.js";
import * as repo from "../repo.js";

const searchPath = z.object({ searchId: z.string().ulid() });
const entryPath = z.object({
  searchId: z.string().ulid(),
  entryId: z.string().ulid()
});
const listQuery = pageQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(500).default(200),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  paid: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional()
});

async function emitHours(
  type: DomainEventType,
  admin: AdminAuth,
  entry: HoursEntry,
  summary: string
): Promise<void> {
  await publishEvents(EVENT_SOURCES.timesheet, {
    type,
    searchId: entry.searchId,
    listingId: entry.listingId ?? undefined,
    actorId: admin.userId,
    actorName: admin.displayName,
    actorRole: "admin",
    at: nowIso(),
    summary
  });
}

const idsCsv = z
  .string()
  .min(1)
  .max(2000)
  .transform((v) => v.split(",").filter(Boolean))
  .pipe(z.array(z.string().ulid()).min(1).max(50));

export const handler = dispatch({
  /** One-call dashboard aggregate: paid/open minutes per search. */
  "GET /api/v1/admin/hours-summary": apiHandler({
    query: z.object({ searchIds: idsCsv }),
    fn: async ({ query, event }) => {
      adminAuth(event);
      const items = [];
      for (const searchId of query.searchIds) {
        const entries = await repo.listEntries(searchId);
        items.push({
          searchId,
          totalMinutes: entries.reduce((a, e) => a + e.minutes, 0),
          openMinutes: entries
            .filter((e) => !e.paid)
            .reduce((a, e) => a + e.minutes, 0)
        });
      }
      return { body: { items } };
    }
  }),

  "GET /api/v1/admin/searches/{searchId}/hours": apiHandler({
    path: searchPath,
    query: listQuery,
    fn: async ({ path, query, event }) => {
      adminAuth(event);
      let entries = await repo.listEntries(path.searchId);
      if (query.month) entries = entriesInMonth(entries, query.month);
      if (query.paid !== undefined) {
        entries = entries.filter((e) => e.paid === query.paid);
      }
      return {
        body: paginateOffset(sortEntries(entries), query.limit, query.cursor)
      };
    }
  }),

  "POST /api/v1/admin/searches/{searchId}/hours": apiHandler({
    path: searchPath,
    body: hoursCreateSchema,
    fn: async ({ path, body, event }) => {
      const admin = adminAuth(event);
      const entry = await repo.createEntry(path.searchId, body);
      await publishAdminAction(EVENT_SOURCES.timesheet, admin, {
        action: "create",
        entity: "hours",
        entityId: entry.id,
        searchId: entry.searchId,
        summary: `Logged ${fmtMinutes(entry.minutes)} (${entry.category})`,
        after: entry
      });
      await emitHours(
        "hours.logged",
        admin,
        entry,
        `${admin.displayName} logged ${fmtMinutes(entry.minutes)} — ${entry.category}`
      );
      return { status: 201, body: entry };
    }
  }),

  "PUT /api/v1/admin/searches/{searchId}/hours/{entryId}": apiHandler({
    path: entryPath,
    body: hoursUpdateSchema,
    fn: async ({ path, body, event }) => {
      const admin = adminAuth(event);
      const { before, after } = await repo.updateEntry(
        path.searchId,
        path.entryId,
        body
      );
      await publishAdminAction(EVENT_SOURCES.timesheet, admin, {
        action: "update",
        entity: "hours",
        entityId: after.id,
        searchId: after.searchId,
        summary:
          body.paid !== undefined && body.paid !== before.paid
            ? `Marked a ${fmtMinutes(after.minutes)} entry as ${after.paid ? "paid" : "outstanding"}`
            : `Updated an hours entry (${fmtMinutes(after.minutes)}, ${after.category})`,
        before,
        after
      });
      await emitHours(
        body.paid !== undefined && body.paid !== before.paid
          ? "hours.paid"
          : "hours.updated",
        admin,
        after,
        `Hours entry updated — ${fmtMinutes(after.minutes)} (${after.category})`
      );
      return { body: after };
    }
  }),

  "DELETE /api/v1/admin/searches/{searchId}/hours/{entryId}": apiHandler({
    path: entryPath,
    fn: async ({ path, event }) => {
      const admin = adminAuth(event);
      const deleted = await repo.deleteEntry(path.searchId, path.entryId);
      await publishAdminAction(EVENT_SOURCES.timesheet, admin, {
        action: "delete",
        entity: "hours",
        entityId: deleted.id,
        searchId: deleted.searchId,
        summary: `Deleted a ${fmtMinutes(deleted.minutes)} entry (${deleted.category})`,
        before: deleted
      });
      await emitHours(
        "hours.deleted",
        admin,
        deleted,
        `Hours entry deleted — ${fmtMinutes(deleted.minutes)}`
      );
      return { status: 204 };
    }
  }),

  "POST /api/v1/admin/searches/{searchId}/hours/pay-month": apiHandler({
    path: searchPath,
    body: payMonthSchema,
    fn: async ({ path, body, event }) => {
      const admin = adminAuth(event);
      const updated = await repo.payMonth(path.searchId, body.month);
      const total = updated.reduce((a, e) => a + e.minutes, 0);
      await publishAdminAction(EVENT_SOURCES.timesheet, admin, {
        action: "pay-month",
        entity: "hours",
        entityId: body.month,
        searchId: path.searchId,
        summary: `Marked ${body.month} as paid — ${updated.length} entr${updated.length === 1 ? "y" : "ies"}, ${fmtMinutes(total)}`
      });
      if (updated.length) {
        await publishEvents(EVENT_SOURCES.timesheet, {
          type: "hours.paid",
          searchId: path.searchId,
          actorId: admin.userId,
          actorName: admin.displayName,
          actorRole: "admin",
          at: nowIso(),
          summary: `${body.month} marked as paid (${fmtMinutes(total)})`
        });
      }
      return { body: { items: updated, totalMinutes: total } };
    }
  }),

  "GET /api/v1/admin/searches/{searchId}/timer": apiHandler({
    path: searchPath,
    fn: async ({ path, event }) => {
      adminAuth(event);
      return { body: { timer: await repo.getTimer(path.searchId) } };
    }
  }),

  "PUT /api/v1/admin/searches/{searchId}/timer": apiHandler({
    path: searchPath,
    body: timerPutSchema,
    fn: async ({ path, body, event }) => {
      adminAuth(event);
      const timer = {
        searchId: path.searchId,
        startedAt: nowIso(),
        category: body.category,
        note: body.note
      };
      await repo.startTimer(timer);
      return { status: 201, body: { timer } };
    }
  }),

  /** Stop & log: converts the running timer into an hours entry. */
  "POST /api/v1/admin/searches/{searchId}/timer/stop": apiHandler({
    path: searchPath,
    fn: async ({ path, event }) => {
      const admin = adminAuth(event);
      const timer = await repo.getTimer(path.searchId);
      if (!timer) {
        return {
          status: 404,
          body: { error: { code: "not_found", message: "No timer running" } }
        };
      }
      const minutes = timerMinutes(timer.startedAt, new Date());
      const entry = await repo.createEntry(path.searchId, {
        date: dateOf(timer.startedAt),
        minutes,
        category: timer.category,
        listingId: null,
        note: timer.note
      });
      await repo.clearTimer(path.searchId);
      await emitHours(
        "hours.logged",
        admin,
        entry,
        `${admin.displayName} logged ${fmtMinutes(minutes)} from the timer — ${entry.category}`
      );
      return { status: 201, body: entry };
    }
  }),

  /** Discard the running timer without logging. */
  "DELETE /api/v1/admin/searches/{searchId}/timer": apiHandler({
    path: searchPath,
    fn: async ({ path, event }) => {
      adminAuth(event);
      await repo.clearTimer(path.searchId);
      return { status: 204 };
    }
  })
});
