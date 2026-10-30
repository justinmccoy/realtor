import { z } from "zod";
import {
  adminAuth,
  apiHandler,
  dispatch,
  nowIso,
  publishAdminAction,
  publishEvents
} from "@jj/lambda-kit";
import {
  ApiError,
  briefSchema,
  EVENT_SOURCES,
  inviteSchema,
  pageQuerySchema,
  searchCreateSchema,
  searchUpdateSchema
} from "@jj/shared";
import { ensureCustomerUser, listCustomerUsers } from "../cognito.js";
import * as repo from "../repo.js";

const searchIdPath = z.object({ searchId: z.string().ulid() });
const memberPath = z.object({
  searchId: z.string().ulid(),
  userId: z.string().min(1).max(128)
});

export const handler = dispatch({
  /** Every customer-pool account — self-registered or invited. */
  "GET /api/v1/admin/users": apiHandler({
    fn: async ({ event }) => {
      adminAuth(event);
      return { body: { items: await listCustomerUsers() } };
    }
  }),

  "POST /api/v1/admin/searches": apiHandler({
    body: searchCreateSchema,
    fn: async ({ body, event }) => {
      const admin = adminAuth(event);
      const search = await repo.createSearch(body);
      await publishAdminAction(EVENT_SOURCES.search, admin, {
        action: "create",
        entity: "search",
        entityId: search.id,
        searchId: search.id,
        summary: `Created search for ${search.clientName}`,
        after: search
      });
      await publishEvents(EVENT_SOURCES.search, {
        type: "search.created",
        searchId: search.id,
        actorId: admin.userId,
        actorName: admin.displayName,
        actorRole: "admin",
        at: nowIso(),
        summary: `Search created for ${search.clientName}`,
        // Event-carried criteria for the listing service's matching copy.
        payload: { settings: search.settings, status: search.status }
      });
      return { status: 201, body: search };
    }
  }),

  "GET /api/v1/admin/searches": apiHandler({
    query: pageQuerySchema,
    fn: async ({ query, event }) => {
      adminAuth(event);
      const page = await repo.listSearches(query.limit, query.cursor);
      return { body: page };
    }
  }),

  "GET /api/v1/admin/searches/{searchId}": apiHandler({
    path: searchIdPath,
    fn: async ({ path, event }) => {
      adminAuth(event);
      const search = await repo.requireSearch(path.searchId);
      const [brief, members] = await Promise.all([
        repo.getBrief(path.searchId),
        repo.listMembers(path.searchId)
      ]);
      return { body: { search, brief, members } };
    }
  }),

  "PUT /api/v1/admin/searches/{searchId}": apiHandler({
    path: searchIdPath,
    body: searchUpdateSchema,
    fn: async ({ path, body, event }) => {
      const admin = adminAuth(event);
      const before = await repo.requireSearch(path.searchId);
      const search = await repo.updateSearch(path.searchId, body);
      await publishAdminAction(EVENT_SOURCES.search, admin, {
        action: "update",
        entity: "search",
        entityId: search.id,
        searchId: search.id,
        summary: `Updated search for ${search.clientName}`,
        before,
        after: search
      });
      await publishEvents(EVENT_SOURCES.search, {
        type:
          before.status !== "archived" && search.status === "archived"
            ? "search.archived"
            : "search.updated",
        searchId: search.id,
        actorId: admin.userId,
        actorName: admin.displayName,
        actorRole: "admin",
        at: nowIso(),
        summary:
          search.status === "archived" && before.status !== "archived"
            ? `Search for ${search.clientName} archived`
            : `Search for ${search.clientName} updated`,
        payload: { settings: search.settings, status: search.status }
      });
      return { body: search };
    }
  }),

  "DELETE /api/v1/admin/searches/{searchId}": apiHandler({
    path: searchIdPath,
    fn: async ({ path, event }) => {
      const admin = adminAuth(event);
      const search = await repo.requireSearch(path.searchId);
      if (search.status !== "archived") {
        throw ApiError.conflict("Archive the search before deleting it");
      }
      await repo.deleteSearch(path.searchId);
      await publishAdminAction(EVENT_SOURCES.search, admin, {
        action: "delete",
        entity: "search",
        entityId: search.id,
        searchId: search.id,
        summary: `Deleted search for ${search.clientName}`,
        before: search
      });
      return { status: 204 };
    }
  }),

  "PUT /api/v1/admin/searches/{searchId}/brief": apiHandler({
    path: searchIdPath,
    body: briefSchema,
    fn: async ({ path, body, event }) => {
      const admin = adminAuth(event);
      const search = await repo.requireSearch(path.searchId);
      await repo.putBrief(path.searchId, body);
      // The artifact keeps the brief budget and the settings budget in sync.
      let settings = search.settings;
      if (body.budget !== search.settings.budget) {
        const updated = await repo.updateSearch(path.searchId, {
          settings: { budget: body.budget }
        });
        settings = updated.settings;
      }
      await publishAdminAction(EVENT_SOURCES.search, admin, {
        action: "update",
        entity: "brief",
        entityId: path.searchId,
        searchId: path.searchId,
        summary: `Updated search requirements for ${search.clientName}`,
        after: body
      });
      await publishEvents(EVENT_SOURCES.search, {
        type: "search.updated",
        searchId: path.searchId,
        actorId: admin.userId,
        actorName: admin.displayName,
        actorRole: "admin",
        at: nowIso(),
        summary: `Search requirements updated for ${search.clientName}`,
        payload: { brief: body, settings, status: search.status }
      });
      return { body };
    }
  }),

  "POST /api/v1/admin/searches/{searchId}/members": apiHandler({
    path: searchIdPath,
    body: inviteSchema,
    fn: async ({ path, body, event }) => {
      const admin = adminAuth(event);
      const search = await repo.requireSearch(path.searchId);
      const { userId, created, invitation } = await ensureCustomerUser(
        body.email,
        body.displayName
      );
      const member = repo.buildMember({
        searchId: path.searchId,
        userId,
        email: body.email,
        displayName: body.displayName,
        role: body.role,
        now: nowIso()
      });
      await repo.putMember(member);
      await publishAdminAction(EVENT_SOURCES.search, admin, {
        action: "invite",
        entity: "member",
        entityId: userId,
        searchId: path.searchId,
        summary: `Invited ${body.displayName} (${body.email}) to ${search.clientName}'s search`,
        after: { ...member, accountCreated: created, invitation }
      });
      await publishEvents(EVENT_SOURCES.search, {
        type: "member.invited",
        searchId: path.searchId,
        actorId: admin.userId,
        actorName: admin.displayName,
        actorRole: "admin",
        at: nowIso(),
        summary: `${body.displayName} invited to the search`,
        payload: { userId, email: body.email, role: body.role, invitation }
      });
      return { status: 201, body: { ...member, accountCreated: created, invitation } };
    }
  }),

  "DELETE /api/v1/admin/searches/{searchId}/members/{userId}": apiHandler({
    path: memberPath,
    fn: async ({ path, event }) => {
      const admin = adminAuth(event);
      await repo.requireSearch(path.searchId);
      await repo.removeMember(path.searchId, path.userId);
      await publishAdminAction(EVENT_SOURCES.search, admin, {
        action: "remove",
        entity: "member",
        entityId: path.userId,
        searchId: path.searchId,
        summary: "Removed a member from the search"
      });
      await publishEvents(EVENT_SOURCES.search, {
        type: "member.removed",
        searchId: path.searchId,
        actorId: admin.userId,
        actorName: admin.displayName,
        actorRole: "admin",
        at: nowIso(),
        summary: "Member removed from the search",
        payload: { userId: path.userId }
      });
      return { status: 204 };
    }
  })
});
