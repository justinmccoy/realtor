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

export const handler = dispatch({
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
