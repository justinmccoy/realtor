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
  remodelSchema,
  sourceCreateSchema,
  type DomainEventType,
  type Listing
} from "@jj/shared";
import {
  applyFilters,
  paginateOffset,
  sortListings
} from "../domain.js";
import * as repo from "../repo.js";

const searchPath = z.object({ searchId: z.string().ulid() });
const listingPath = z.object({
  searchId: z.string().ulid(),
  listingId: z.string().ulid()
});
const sourcePath = z.object({
  searchId: z.string().ulid(),
  sourceId: z.string().ulid()
});

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

const listQuery = pageQuerySchema.merge(listingListQuerySchema);

async function emitListing(
  type: DomainEventType,
  admin: AdminAuth,
  listing: Listing,
  summary: string
): Promise<void> {
  await publishEvents(EVENT_SOURCES.listing, {
    type,
    searchId: listing.searchId,
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
  const { after } = await repo.updateListing(listing.searchId, listing.id, {
    published
  });
  await publishAdminAction(EVENT_SOURCES.listing, admin, {
    action: published ? "publish" : "unpublish",
    entity: "listing",
    entityId: after.id,
    searchId: after.searchId,
    listingId: after.id,
    summary: `${published ? "Published" : "Unpublished"} "${after.title}"`
  });
  await emitListing(
    published ? "listing.published" : "listing.unpublished",
    admin,
    after,
    `"${after.title}" is ${published ? "now visible to the client" : "hidden from the client"}`
  );
  return after;
}

export const handler = dispatch({
  "GET /api/v1/admin/searches/{searchId}/listings": apiHandler({
    path: searchPath,
    query: listQuery,
    fn: async ({ path, query, event }) => {
      adminAuth(event);
      const all = await repo.listAll(path.searchId);
      const filtered = sortListings(applyFilters(all, query), query.sort);
      return { body: paginateOffset(filtered, query.limit, query.cursor) };
    }
  }),

  "POST /api/v1/admin/searches/{searchId}/listings": apiHandler({
    path: searchPath,
    body: listingCreateSchema,
    fn: async ({ path, body, event }) => {
      const admin = adminAuth(event);
      const listing = await repo.createListing(path.searchId, body);
      await publishAdminAction(EVENT_SOURCES.listing, admin, {
        action: "create",
        entity: "listing",
        entityId: listing.id,
        searchId: listing.searchId,
        listingId: listing.id,
        summary: `Added listing "${listing.title}"`,
        after: listing
      });
      await emitListing(
        "listing.created",
        admin,
        listing,
        `Listing "${listing.title}" added`
      );
      return { status: 201, body: listing };
    }
  }),

  "GET /api/v1/admin/searches/{searchId}/listings/{listingId}": apiHandler({
    path: listingPath,
    fn: async ({ path, event }) => {
      adminAuth(event);
      return { body: await repo.requireListing(path.searchId, path.listingId) };
    }
  }),

  "PUT /api/v1/admin/searches/{searchId}/listings/{listingId}": apiHandler({
    path: listingPath,
    body: listingUpdateSchema,
    fn: async ({ path, body, event }) => {
      const admin = adminAuth(event);
      const { before, after } = await repo.updateListing(
        path.searchId,
        path.listingId,
        body
      );
      await publishAdminAction(EVENT_SOURCES.listing, admin, {
        action: "update",
        entity: "listing",
        entityId: after.id,
        searchId: after.searchId,
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

  "PATCH /api/v1/admin/searches/{searchId}/listings/{listingId}/status":
    apiHandler({
      path: listingPath,
      body: statusPatch,
      fn: async ({ path, body, event }) => {
        const admin = adminAuth(event);
        const { before, after } = await repo.updateListing(
          path.searchId,
          path.listingId,
          body
        );
        await publishAdminAction(EVENT_SOURCES.listing, admin, {
          action: "set-status",
          entity: "listing",
          entityId: after.id,
          searchId: after.searchId,
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

  "PATCH /api/v1/admin/searches/{searchId}/listings/{listingId}/contact":
    apiHandler({
      path: listingPath,
      body: contactPatch,
      fn: async ({ path, body, event }) => {
        const admin = adminAuth(event);
        const { after } = await repo.updateListing(
          path.searchId,
          path.listingId,
          body
        );
        await publishAdminAction(EVENT_SOURCES.listing, admin, {
          action: "set-contact",
          entity: "listing",
          entityId: after.id,
          searchId: after.searchId,
          listingId: after.id,
          summary: `"${after.title}": contact status ${after.contact}`
        });
        return { body: after };
      }
    }),

  "PATCH /api/v1/admin/searches/{searchId}/listings/{listingId}/rank":
    apiHandler({
      path: listingPath,
      body: rankPatch,
      fn: async ({ path, body, event }) => {
        const admin = adminAuth(event);
        const { after } = await repo.updateListing(
          path.searchId,
          path.listingId,
          body
        );
        await publishAdminAction(EVENT_SOURCES.listing, admin, {
          action: "set-rank",
          entity: "listing",
          entityId: after.id,
          searchId: after.searchId,
          listingId: after.id,
          summary: after.topRank
            ? `"${after.title}" ranked #${after.topRank} in the top 5`
            : `"${after.title}" removed from the top 5`
        });
        return { body: after };
      }
    }),

  "PATCH /api/v1/admin/searches/{searchId}/listings/{listingId}/remodel":
    apiHandler({
      path: listingPath,
      body: remodelPatch,
      fn: async ({ path, body, event }) => {
        const admin = adminAuth(event);
        const { after } = await repo.updateListing(
          path.searchId,
          path.listingId,
          body
        );
        await publishAdminAction(EVENT_SOURCES.listing, admin, {
          action: "set-remodel",
          entity: "listing",
          entityId: after.id,
          searchId: after.searchId,
          listingId: after.id,
          summary: `Remodelling assessment updated for "${after.title}"`
        });
        return { body: after };
      }
    }),

  "PATCH /api/v1/admin/searches/{searchId}/listings/{listingId}/publish":
    apiHandler({
      path: listingPath,
      body: publishPatch,
      fn: async ({ path, body, event }) => {
        const admin = adminAuth(event);
        const listing = await repo.requireListing(path.searchId, path.listingId);
        return { body: await applyPublish(admin, listing, body.published) };
      }
    }),

  "DELETE /api/v1/admin/searches/{searchId}/listings/{listingId}": apiHandler({
    path: listingPath,
    fn: async ({ path, event }) => {
      const admin = adminAuth(event);
      const deleted = await repo.deleteListing(path.searchId, path.listingId);
      await publishAdminAction(EVENT_SOURCES.listing, admin, {
        action: "delete",
        entity: "listing",
        entityId: deleted.id,
        searchId: deleted.searchId,
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

  "POST /api/v1/admin/searches/{searchId}/listings/bulk": apiHandler({
    path: searchPath,
    body: bulkSchema,
    fn: async ({ path, body, event }) => {
      const admin = adminAuth(event);
      const results: Listing[] = [];
      for (const id of body.ids) {
        if (body.op === "delete") {
          const deleted = await repo.deleteListing(path.searchId, id);
          await emitListing(
            "listing.deleted",
            admin,
            deleted,
            `Listing "${deleted.title}" deleted`
          );
          continue;
        }
        const listing = await repo.requireListing(path.searchId, id);
        if (body.op === "publish" || body.op === "unpublish") {
          results.push(await applyPublish(admin, listing, body.op === "publish"));
        } else {
          const { after } = await repo.updateListing(path.searchId, id, {
            status: body.status
          });
          results.push(after);
        }
      }
      await publishAdminAction(EVENT_SOURCES.listing, admin, {
        action: `bulk-${body.op}`,
        entity: "listing",
        entityId: body.ids.join(","),
        searchId: path.searchId,
        summary: `Bulk ${body.op} on ${body.ids.length} listing(s)`
      });
      return { body: { items: results } };
    }
  }),

  "GET /api/v1/admin/viewings": apiHandler({
    query: viewingsQuery,
    fn: async ({ query, event }) => {
      adminAuth(event);
      return { body: { items: await repo.upcomingViewings(query.days) } };
    }
  }),

  "GET /api/v1/admin/searches/{searchId}/inbox": apiHandler({
    path: searchPath,
    fn: async ({ path, event }) => {
      adminAuth(event);
      return { body: { items: await repo.listSources(path.searchId) } };
    }
  }),

  "POST /api/v1/admin/searches/{searchId}/inbox": apiHandler({
    path: searchPath,
    body: sourceCreateSchema,
    fn: async ({ path, body, event }) => {
      const admin = adminAuth(event);
      const created = await repo.addSources(path.searchId, body.urls);
      await publishAdminAction(EVENT_SOURCES.listing, admin, {
        action: "inbox-add",
        entity: "source",
        entityId: created.map((s) => s.id).join(","),
        searchId: path.searchId,
        summary: `Added ${created.length} link(s) to the inbox`
      });
      return { status: 201, body: { items: created } };
    }
  }),

  "PATCH /api/v1/admin/searches/{searchId}/inbox/{sourceId}": apiHandler({
    path: sourcePath,
    body: sourcePatch,
    fn: async ({ path, body, event }) => {
      adminAuth(event);
      return {
        body: await repo.updateSource(path.searchId, path.sourceId, body)
      };
    }
  }),

  "DELETE /api/v1/admin/searches/{searchId}/inbox/{sourceId}": apiHandler({
    path: sourcePath,
    fn: async ({ path, event }) => {
      adminAuth(event);
      await repo.deleteSource(path.searchId, path.sourceId);
      return { status: 204 };
    }
  })
});
