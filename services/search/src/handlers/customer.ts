import { z } from "zod";
import {
  apiHandler,
  customerAuth,
  dispatch,
  nowIso,
  publishEvents,
  requireSearchAccess
} from "@jj/lambda-kit";
import { ApiError, EVENT_SOURCES, type Search } from "@jj/shared";
import * as repo from "../repo.js";

const searchIdPath = z.object({ searchId: z.string().ulid() });

function searchLite(s: Search): Omit<Search, "createdAt" | "updatedAt"> {
  return {
    id: s.id,
    clientName: s.clientName,
    status: s.status,
    settings: s.settings
  };
}

export const handler = dispatch({
  "GET /api/v1/searches": apiHandler({
    fn: async ({ event }) => {
      const auth = customerAuth(event);
      const ids = Object.keys(auth.memberships);
      const searches = (await Promise.all(ids.map((id) => repo.getSearch(id))))
        .filter((s): s is Search => s !== null)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return {
        body: {
          items: searches.map((s) => ({
            ...searchLite(s),
            role: auth.memberships[s.id]
          }))
        }
      };
    }
  }),

  "GET /api/v1/searches/{searchId}": apiHandler({
    path: searchIdPath,
    fn: async ({ path, event }) => {
      const auth = customerAuth(event);
      const role = requireSearchAccess(auth, path.searchId);
      const search = await repo.getSearch(path.searchId);
      if (!search) throw ApiError.notFound("Search");
      const brief = await repo.getBrief(path.searchId);

      // Interaction tracking: at most one "opened the search" per 15 minutes.
      const fresh = await repo.touchLastSeen(path.searchId, auth.userId);
      if (fresh) {
        await publishEvents(EVENT_SOURCES.search, {
          type: "client.signed_in",
          searchId: path.searchId,
          actorId: auth.userId,
          actorName: auth.displayName,
          actorRole: role,
          at: nowIso(),
          summary: `${auth.displayName} opened the search`
        });
      }
      return { body: { search: searchLite(search), brief, role } };
    }
  })
});
