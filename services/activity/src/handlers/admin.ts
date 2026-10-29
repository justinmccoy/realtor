import { z } from "zod";
import { adminAuth, apiHandler, dispatch } from "@jj/lambda-kit";
import { pageQuerySchema } from "@jj/shared";
import * as repo from "../repo.js";

const searchPath = z.object({ searchId: z.string().ulid() });

const feedQuery = pageQuerySchema.extend({
  searchId: z.string().ulid().optional(),
  actorId: z.string().max(128).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional()
});

const auditQuery = pageQuerySchema.extend({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  adminId: z.string().max(128).optional(),
  entity: z.string().max(40).optional()
});

const idsCsv = (max: number) =>
  z
    .string()
    .min(1)
    .max(4000)
    .transform((v) => v.split(",").filter(Boolean))
    .pipe(z.array(z.string().min(1).max(128)).min(1).max(max));

export const handler = dispatch({
  /** One-call aggregate for dashboards: last activity per search and
   *  30-day event counts per actor — replaces N individual feed queries. */
  "GET /api/v1/admin/activity-summary": apiHandler({
    query: z.object({
      searchIds: idsCsv(50).optional(),
      actorIds: idsCsv(100).optional()
    }),
    fn: async ({ query, event }) => {
      adminAuth(event);
      const from = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const searches = [];
      for (const searchId of query.searchIds ?? []) {
        const page = await repo.feedBySearch(searchId, { limit: 1 });
        searches.push({ searchId, lastActivityAt: page.items[0]?.at ?? null });
      }
      const actors = [];
      for (const actorId of query.actorIds ?? []) {
        const page = await repo.feedByActor(actorId, { limit: 100, from });
        actors.push({ actorId, events30d: page.items.length });
      }
      return { body: { searches, actors } };
    }
  }),

  /** Activity feed: per search, per actor, or global recent. */
  "GET /api/v1/admin/activity": apiHandler({
    query: feedQuery,
    fn: async ({ query, event }) => {
      adminAuth(event);
      const range = {
        limit: query.limit,
        cursor: query.cursor,
        from: query.from,
        to: query.to
      };
      if (query.actorId) {
        return { body: await repo.feedByActor(query.actorId, range) };
      }
      if (query.searchId) {
        return { body: await repo.feedBySearch(query.searchId, range) };
      }
      return { body: await repo.feedGlobal(range) };
    }
  }),

  /** Permanent audit log of admin actions. Filters apply within the page. */
  "GET /api/v1/admin/audit": apiHandler({
    query: auditQuery,
    fn: async ({ query, event }) => {
      adminAuth(event);
      const page = await repo.auditLog({
        limit: query.limit,
        cursor: query.cursor,
        from: query.from,
        to: query.to
      });
      let items = page.items;
      if (query.adminId) items = items.filter((i) => i.adminId === query.adminId);
      if (query.entity) items = items.filter((i) => i.entity === query.entity);
      return { body: { items, nextCursor: page.nextCursor } };
    }
  }),

  /** Per-listing engagement counters for a search (admin dashboard). */
  "GET /api/v1/admin/searches/{searchId}/engagement": apiHandler({
    path: searchPath,
    fn: async ({ path, event }) => {
      adminAuth(event);
      return { body: { items: await repo.engagementForSearch(path.searchId) } };
    }
  })
});
