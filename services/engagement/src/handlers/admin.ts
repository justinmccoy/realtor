import { z } from "zod";
import {
  adminAuth,
  apiHandler,
  dispatch,
  newId,
  nowIso,
  publishAdminAction,
  publishEvents
} from "@jj/lambda-kit";
import {
  ApiError,
  commentCreateSchema,
  EVENT_SOURCES,
  pageQuerySchema,
  paginateOffset,
  type Comment
} from "@jj/shared";
import * as repo from "../repo.js";

const searchPath = z.object({ searchId: z.string().ulid() });
const ratingPath = z.object({
  searchId: z.string().ulid(),
  listingId: z.string().ulid(),
  userId: z.string().min(1).max(128)
});
const commentPath = z.object({
  searchId: z.string().ulid(),
  commentId: z.string().ulid()
});

export const handler = dispatch({
  "GET /api/v1/admin/searches/{searchId}/ratings": apiHandler({
    path: searchPath,
    fn: async ({ path, event }) => {
      adminAuth(event);
      return { body: { items: await repo.listRatingsBySearch(path.searchId) } };
    }
  }),

  /** Moderation: remove a user's rating. */
  "DELETE /api/v1/admin/searches/{searchId}/listings/{listingId}/ratings/{userId}":
    apiHandler({
      path: ratingPath,
      fn: async ({ path, event }) => {
        const admin = adminAuth(event);
        const existing = await repo.getRating(path.listingId, path.userId);
        if (!existing || existing.searchId !== path.searchId) {
          throw ApiError.notFound("Rating");
        }
        await repo.deleteRating(path.listingId, path.userId);
        await publishAdminAction(EVENT_SOURCES.engagement, admin, {
          action: "delete",
          entity: "rating",
          entityId: `${path.listingId}/${path.userId}`,
          searchId: path.searchId,
          listingId: path.listingId,
          summary: `Removed ${existing.authorName}'s rating`,
          before: existing
        });
        return { status: 204 };
      }
    }),

  "GET /api/v1/admin/searches/{searchId}/comments": apiHandler({
    path: searchPath,
    query: pageQuerySchema,
    fn: async ({ path, query, event }) => {
      adminAuth(event);
      const comments = await repo.listComments(path.searchId);
      return { body: paginateOffset(comments, query.limit, query.cursor) };
    }
  }),

  /** Admin replies in a thread (JJ's voice). */
  "POST /api/v1/admin/searches/{searchId}/comments": apiHandler({
    path: searchPath,
    body: commentCreateSchema,
    fn: async ({ path, body, event }) => {
      const admin = adminAuth(event);
      if (body.listingId) {
        await repo.requireListingActive(body.listingId, {
          mustBePublished: false
        });
      }
      if (body.parentId) {
        const parent = await repo.getComment(path.searchId, body.parentId);
        if (!parent) throw ApiError.notFound("Parent comment");
      }
      const comment: Comment = {
        id: newId(),
        searchId: path.searchId,
        listingId: body.listingId,
        parentId: body.parentId,
        authorId: admin.userId,
        authorName: admin.displayName,
        authorRole: "admin",
        body: body.body,
        createdAt: nowIso(),
        deletedAt: null
      };
      await repo.putComment(comment);
      await publishEvents(EVENT_SOURCES.engagement, {
        type: "comment.created",
        searchId: path.searchId,
        listingId: body.listingId ?? undefined,
        actorId: admin.userId,
        actorName: admin.displayName,
        actorRole: "admin",
        at: comment.createdAt,
        summary: `${admin.displayName} commented`,
        payload: { commentId: comment.id, parentId: comment.parentId }
      });
      return { status: 201, body: comment };
    }
  }),

  /** Removes the comment (and, for a root, its replies) outright. Nothing
   *  marks the gap in either app; only the audit log keeps the record. */
  "DELETE /api/v1/admin/searches/{searchId}/comments/{commentId}": apiHandler({
    path: commentPath,
    fn: async ({ path, event }) => {
      const admin = adminAuth(event);
      const { removed, replies } = await repo.deleteComment(path.searchId, path.commentId);
      const withReplies =
        replies.length === 0
          ? ""
          : ` and ${replies.length} ${replies.length === 1 ? "reply" : "replies"}`;
      await publishAdminAction(EVENT_SOURCES.engagement, admin, {
        action: "delete",
        entity: "comment",
        entityId: removed.id,
        searchId: path.searchId,
        summary: `Deleted a comment by ${removed.authorName}${withReplies}`,
        before: { comment: removed, replies }
      });
      return { status: 204 };
    }
  })
});
