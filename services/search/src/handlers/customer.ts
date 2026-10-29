import { z } from "zod";
import {
  apiHandler,
  customerAuth,
  dispatch,
  nowIso,
  publishEvents,
  requireSearchAccess
} from "@jj/lambda-kit";
import { ApiError, EVENT_SOURCES, inviteSchema, type Search } from "@jj/shared";
import { ensureCustomerUser } from "../cognito.js";
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
      // "New since your last visit" baseline — read before touching.
      const member = await repo.getMember(path.searchId, auth.userId);
      const prevSeenAt = member?.lastSeenAt ?? null;

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
      return { body: { search: searchLite(search), brief, role, prevSeenAt } };
    }
  }),

  /** Who has access to this search — shown in the client's invite overlay. */
  "GET /api/v1/searches/{searchId}/members": apiHandler({
    path: searchIdPath,
    fn: async ({ path, event }) => {
      const auth = customerAuth(event);
      requireSearchAccess(auth, path.searchId);
      const members = await repo.listMembers(path.searchId);
      return {
        body: {
          items: members
            .sort((a, b) => a.invitedAt.localeCompare(b.invitedAt))
            .map((m) => ({
              userId: m.userId,
              displayName: m.displayName,
              email: m.email,
              role: m.role,
              invitedAt: m.invitedAt,
              lastSeenAt: m.lastSeenAt
            }))
        }
      };
    }
  }),

  /**
   * A client with edit access invites someone to their own search, as a
   * viewer or with edit access. Mirrors the admin invite: Cognito emails a
   * temporary password to new accounts; existing accounts just gain access.
   */
  "POST /api/v1/searches/{searchId}/members": apiHandler({
    path: searchIdPath,
    body: inviteSchema,
    fn: async ({ path, body, event }) => {
      const auth = customerAuth(event);
      const role = requireSearchAccess(auth, path.searchId);
      if (role !== "client") {
        throw ApiError.forbidden("Only members with edit access can invite others");
      }
      const search = await repo.getSearch(path.searchId);
      if (!search) throw ApiError.notFound("Search");
      if (search.status !== "active") {
        throw ApiError.conflict("This search is archived");
      }
      const email = body.email.trim().toLowerCase();
      if (email === auth.email.toLowerCase()) {
        throw ApiError.conflict("You already have access to this search");
      }
      const { userId, created } = await ensureCustomerUser(email, body.displayName);
      if (await repo.getMember(path.searchId, userId)) {
        throw ApiError.conflict(`${email} already has access to this search`);
      }
      const now = nowIso();
      const member = repo.buildMember({
        searchId: path.searchId,
        userId,
        email,
        displayName: body.displayName,
        role: body.role,
        now
      });
      await repo.putMember(member);
      await publishEvents(EVENT_SOURCES.search, {
        type: "member.invited",
        searchId: path.searchId,
        actorId: auth.userId,
        actorName: auth.displayName,
        actorRole: role,
        at: now,
        summary: `${auth.displayName} invited ${body.displayName} (${email}) with ${
          body.role === "client" ? "edit" : "view-only"
        } access`,
        payload: {
          userId,
          email,
          displayName: body.displayName,
          role: body.role,
          accountCreated: created
        }
      });
      return { status: 201, body: { ...member, accountCreated: created } };
    }
  })
});
