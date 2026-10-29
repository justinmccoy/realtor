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
  CONTACT_STATUSES,
  EVENT_SOURCES,
  LISTING_STATUSES,
  SOURCE_STATUSES,
  listingCreateSchema,
  listingListQuerySchema,
  listingUpdateSchema,
  pageQuerySchema,
  paginateOffset,
  remodelSchema,
  sharePutSchema,
  sourceCreateSchema,
  type DomainEventType,
  type Listing
} from "@jj/shared";
import { applyFilters, sortListings } from "../domain.js";
import * as repo from "../repo.js";

const listingPath = z.object({ listingId: z.string().ulid() });
const sharePath = z.object({
  searchId: z.string().ulid(),
  listingId: z.string().ulid()
});
const searchPath = z.object({ searchId: z.string().ulid() });
const sourcePath = z.object({ sourceId: z.string().ulid() });

const statusPatch = z.object({ status: z.enum(LISTING_STATUSES) });
const contactPatch = z.object({ contact: z.enum(CONTACT_STATUSES) });
const rankPatch = z.object({ topRank: z.number().int().min(0).max(5) });
const remodelPatch = z.object({ remodel: remodelSchema.nullable() });
const publishPatch = z.object({ published: z.boolean() });
const sourcePatch = z.object({
  status: z.enum(SOURCE_STATUSES).optional(),
  listingId: z.string().ulid().nullable().optional()
});
const bulkSchema = z
  .object({
    ids: z.array(z.string().ulid()).min(1).max(100),
    op: z.enum(["publish", "unpublish", "status", "delete"]),
    status: z.enum(LISTING_STATUSES).optional()
  })
  .refine((b) => b.op !== "status" || b.status !== undefined, {
    message: "status is required for the status op",
    path: ["status"]
  });
const viewingsQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).default(14)
});

const listQuery = pageQuerySchema.merge(listingListQuerySchema).extend({
  // The admin table loads the whole pool in one page.
  limit: z.coerce.number().int().min(1).max(500).default(200)
});

async function emitListing(
  type: DomainEventType,
  admin: AdminAuth,
  listing: Listing,
  summary: string,
  searchId?: string
): Promise<void> {
  await publishEvents(EVENT_SOURCES.listing, {
    type,
    searchId,
    listingId: listing.id,
    actorId: admin.userId,
    actorName: admin.displayName,
    actorRole: "admin",
    at: nowIso(),
    summary,
    // Event-carried state for downstream services (media, engagement).
    payload: { title: listing.title, published: listing.published }
  });
}

async function applyPublish(
  admin: AdminAuth,
  listing: Listing,
  published: boolean
): Promise<Listing> {
  if (listing.published === published) return listing;
  const { after } = await repo.updateListing(listing.id, { published });
  await publishAdminAction(EVENT_SOURCES.listing, admin, {
    action: published ? "activate" : "deactivate",
    entity: "listing",
    entityId: after.id,
    listingId: after.id,
    summary: `${published ? "Activated" : "Deactivated"} "${after.title}"`
  });
  await emitListing(
    published ? "listing.published" : "listing.unpublished",
    admin,
    after,
    `"${after.title}" is ${published ? "now active" : "now a draft (hidden everywhere)"}`
  );
  return after;
}

export const handler = dispatch({
  "GET /api/v1/admin/listings": apiHandler({
    query: listQuery,
    fn: async ({ query, event }) => {
      adminAuth(event);
      const all = await repo.listAll();
      const filtered = sortListings(applyFilters(all, query), query.sort);
      return { body: paginateOffset(filtered, query.limit, query.cursor) };
    }
  }),

  "POST /api/v1/admin/listings": apiHandler({
    body: listingCreateSchema,
    fn: async ({ body, event }) => {
      const admin = adminAuth(event);
      const listing = await repo.createListing(body);
      await publishAdminAction(EVENT_SOURCES.listing, admin, {
        action: "create",
        entity: "listing",
        entityId: listing.id,
        listingId: listing.id,
        summary: `Added listing "${listing.title}"`,
        after: listing
      });
      await emitListing(
        "listing.created",
        admin,
        listing,
        `Listing "${listing.title}" added to the pool`
      );
      return { status: 201, body: listing };
    }
  }),

  "GET /api/v1/admin/listings/{listingId}": apiHandler({
    path: listingPath,
    fn: async ({ path, event }) => {
      adminAuth(event);
      return { body: await repo.requireListing(path.listingId) };
    }
  }),

  "PUT /api/v1/admin/listings/{listingId}": apiHandler({
    path: listingPath,
    body: listingUpdateSchema,
    fn: async ({ path, body, event }) => {
      const admin = adminAuth(event);
      const { before, after } = await repo.updateListing(path.listingId, body);
      await publishAdminAction(EVENT_SOURCES.listing, admin, {
        action: "update",
        entity: "listing",
        entityId: after.id,
        listingId: after.id,
        summary: `Updated listing "${after.title}"`,
        before,
        after
      });
      await emitListing(
        "listing.updated",
        admin,
        after,
        `Listing "${after.title}" updated`
      );
      return { body: after };
    }
  }),

  "PATCH /api/v1/admin/listings/{listingId}/status": apiHandler({
    path: listingPath,
    body: statusPatch,
    fn: async ({ path, body, event }) => {
      const admin = adminAuth(event);
      const { before, after } = await repo.updateListing(path.listingId, body);
      await publishAdminAction(EVENT_SOURCES.listing, admin, {
        action: "set-status",
        entity: "listing",
        entityId: after.id,
        listingId: after.id,
        summary: `"${after.title}": ${before.status} → ${after.status}`
      });
      await emitListing(
        "listing.updated",
        admin,
        after,
        `"${after.title}" moved to ${after.status}`
      );
      return { body: after };
    }
  }),

  "PATCH /api/v1/admin/listings/{listingId}/contact": apiHandler({
    path: listingPath,
    body: contactPatch,
    fn: async ({ path, body, event }) => {
      const admin = adminAuth(event);
      const { after } = await repo.updateListing(path.listingId, body);
      await publishAdminAction(EVENT_SOURCES.listing, admin, {
        action: "set-contact",
        entity: "listing",
        entityId: after.id,
        listingId: after.id,
        summary: `"${after.title}": contact status ${after.contact}`
      });
      return { body: after };
    }
  }),

  "PATCH /api/v1/admin/listings/{listingId}/rank": apiHandler({
    path: listingPath,
    body: rankPatch,
    fn: async ({ path, body, event }) => {
      const admin = adminAuth(event);
      const { after } = await repo.updateListing(path.listingId, body);
      await publishAdminAction(EVENT_SOURCES.listing, admin, {
        action: "set-rank",
        entity: "listing",
        entityId: after.id,
        listingId: after.id,
        summary: after.topRank
          ? `"${after.title}" ranked #${after.topRank} in the top 5`
          : `"${after.title}" removed from the top 5`
      });
      return { body: after };
    }
  }),

  "PATCH /api/v1/admin/listings/{listingId}/remodel": apiHandler({
    path: listingPath,
    body: remodelPatch,
    fn: async ({ path, body, event }) => {
      const admin = adminAuth(event);
      const { after } = await repo.updateListing(path.listingId, body);
      await publishAdminAction(EVENT_SOURCES.listing, admin, {
        action: "set-remodel",
        entity: "listing",
        entityId: after.id,
        listingId: after.id,
        summary: `Remodelling assessment updated for "${after.title}"`
      });
      return { body: after };
    }
  }),

  "PATCH /api/v1/admin/listings/{listingId}/publish": apiHandler({
    path: listingPath,
    body: publishPatch,
    fn: async ({ path, body, event }) => {
      const admin = adminAuth(event);
      const listing = await repo.requireListing(path.listingId);
      return { body: await applyPublish(admin, listing, body.published) };
    }
  }),

  "DELETE /api/v1/admin/listings/{listingId}": apiHandler({
    path: listingPath,
    fn: async ({ path, event }) => {
      const admin = adminAuth(event);
      const deleted = await repo.deleteListing(path.listingId);
      await publishAdminAction(EVENT_SOURCES.listing, admin, {
        action: "delete",
        entity: "listing",
        entityId: deleted.id,
        listingId: deleted.id,
        summary: `Deleted listing "${deleted.title}"`,
        before: deleted
      });
      await emitListing(
        "listing.deleted",
        admin,
        deleted,
        `Listing "${deleted.title}" deleted`
      );
      return { status: 204 };
    }
  }),

  "POST /api/v1/admin/listings/bulk": apiHandler({
    body: bulkSchema,
    fn: async ({ body, event }) => {
      const admin = adminAuth(event);
      const results: Listing[] = [];
      for (const id of body.ids) {
        if (body.op === "delete") {
          const deleted = await repo.deleteListing(id);
          await emitListing(
            "listing.deleted",
            admin,
            deleted,
            `Listing "${deleted.title}" deleted`
          );
          continue;
        }
        const listing = await repo.requireListing(id);
        if (body.op === "publish" || body.op === "unpublish") {
          results.push(await applyPublish(admin, listing, body.op === "publish"));
        } else {
          const { after } = await repo.updateListing(id, { status: body.status });
          results.push(after);
        }
      }
      await publishAdminAction(EVENT_SOURCES.listing, admin, {
        action: `bulk-${body.op}`,
        entity: "listing",
        entityId: body.ids.join(","),
        summary: `Bulk ${body.op} on ${body.ids.length} listing(s)`
      });
      return { body: { items: results } };
    }
  }),

  /* ---------- per-search sharing ---------- */

  "GET /api/v1/admin/searches/{searchId}/shares": apiHandler({
    path: searchPath,
    fn: async ({ path, event }) => {
      adminAuth(event);
      const shares = await repo.listShares(path.searchId);
      return {
        body: {
          items: [...shares.entries()].map(([listingId, mode]) => ({
            listingId,
            mode
          }))
        }
      };
    }
  }),

  "PUT /api/v1/admin/searches/{searchId}/shares/{listingId}": apiHandler({
    path: sharePath,
    body: sharePutSchema,
    fn: async ({ path, body, event }) => {
      const admin = adminAuth(event);
      const listing = await repo.requireListing(path.listingId);
      await repo.putShare(path.searchId, path.listingId, body.mode);
      await publishAdminAction(EVENT_SOURCES.listing, admin, {
        action: body.mode === "shared" ? "share" : "hide",
        entity: "listing",
        entityId: listing.id,
        searchId: path.searchId,
        listingId: listing.id,
        summary: `${body.mode === "shared" ? "Shared" : "Hid"} "${listing.title}" ${body.mode === "shared" ? "with" : "from"} the client`
      });
      await emitListing(
        body.mode === "shared" ? "listing.shared" : "listing.unshared",
        admin,
        listing,
        `"${listing.title}" ${body.mode === "shared" ? "shared with" : "hidden from"} the client`,
        path.searchId
      );
      return { body: { listingId: path.listingId, mode: body.mode } };
    }
  }),

  /** Clear the override — visibility returns to brief auto-matching. */
  "DELETE /api/v1/admin/searches/{searchId}/shares/{listingId}": apiHandler({
    path: sharePath,
    fn: async ({ path, event }) => {
      const admin = adminAuth(event);
      await repo.clearShare(path.searchId, path.listingId);
      await publishAdminAction(EVENT_SOURCES.listing, admin, {
        action: "share-auto",
        entity: "listing",
        entityId: path.listingId,
        searchId: path.searchId,
        listingId: path.listingId,
        summary: "Share override cleared — visibility follows the brief again"
      });
      return { status: 204 };
    }
  }),

  "GET /api/v1/admin/viewings": apiHandler({
    query: viewingsQuery,
    fn: async ({ query, event }) => {
      adminAuth(event);
      return { body: { items: await repo.upcomingViewings(query.days) } };
    }
  }),

  /* ---------- link inbox (global) ---------- */

  "GET /api/v1/admin/inbox": apiHandler({
    fn: async ({ event }) => {
      adminAuth(event);
      return { body: { items: await repo.listSources() } };
    }
  }),

  "POST /api/v1/admin/inbox": apiHandler({
    body: sourceCreateSchema,
    fn: async ({ body, event }) => {
      const admin = adminAuth(event);
      const created = await repo.addSources(body.urls);
      await publishAdminAction(EVENT_SOURCES.listing, admin, {
        action: "inbox-add",
        entity: "source",
        entityId: created.map((s) => s.id).join(","),
        summary: `Added ${created.length} link(s) to the inbox`
      });
      return { status: 201, body: { items: created } };
    }
  }),

  "PATCH /api/v1/admin/inbox/{sourceId}": apiHandler({
    path: sourcePath,
    body: sourcePatch,
    fn: async ({ path, body, event }) => {
      adminAuth(event);
      return { body: await repo.updateSource(path.sourceId, body) };
    }
  }),

  "DELETE /api/v1/admin/inbox/{sourceId}": apiHandler({
    path: sourcePath,
    fn: async ({ path, event }) => {
      adminAuth(event);
      await repo.deleteSource(path.sourceId);
      return { status: 204 };
    }
  })
});
