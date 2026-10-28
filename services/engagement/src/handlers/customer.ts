import { z } from "zod";
import {
  apiHandler,
  customerAuth,
  dispatch,
  newId,
  nowIso,
  publishEvents,
  requireSearchAccess
} from "@jj/lambda-kit";
import {
  ApiError,
  commentCreateSchema,
  EVENT_SOURCES,
  pageQuerySchema,
  paginateOffset,
  ratingPutSchema,
  type Comment,
  type Rating
} from "@jj/shared";
import * as repo from "../repo.js";

const searchPath = z.object({ searchId: z.string().ulid() });
const listingPath = z.object({
  searchId: z.string().ulid(),
  listingId: z.string().ulid()
});
const commentsQuery = pageQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(200).default(100)
});

export const handler = dispatch({
  "GET /api/v1/searches/{searchId}/ratings": apiHandler({
    path: searchPath,
    fn: async ({ path, event }) => {
      const auth = customerAuth(event);
      requireSearchAccess(auth, path.searchId);
      return { body: { items: await repo.listRatingsBySearch(path.searchId) } };
    }
  }),

  "PUT /api/v1/searches/{searchId}/listings/{listingId}/rating": apiHandler({
    path: listingPath,
    body: ratingPutSchema,
    fn: async ({ path, body, event }) => {
      const auth = customerAuth(event);
      const role = requireSearchAccess(auth, path.searchId);
      if (role === "viewer") {
        // Mirrors the artifact: viewers can comment but not save star ratings.
        throw ApiError.forbidden(
          "Star ratings can't be saved with viewer access — leave your rating as a comment instead"
        );
      }
      const meta = await repo.requireListingActive(path.listingId, {
        mustBePublished: true
      });
      const rating: Rating = {
        listingId: path.listingId,
        searchId: path.searchId,
        userId: auth.userId,
        authorName: auth.displayName,
        score: body.score,
        comment: body.comment,
        updatedAt: nowIso()
      };
      await repo.putRating(rating);
      await publishEvents(EVENT_SOURCES.engagement, {
        type: "rating.saved",
        searchId: path.searchId,
        listingId: path.listingId,
        actorId: auth.userId,
        actorName: auth.displayName,
        actorRole: role,
        at: rating.updatedAt,
        summary: `${auth.displayName} rated "${meta.title}" ${body.score}★`,
        payload: { score: body.score, comment: body.comment }
      });
      return { body: rating };
    }
  }),

  "DELETE /api/v1/searches/{searchId}/listings/{listingId}/rating": apiHandler({
    path: listingPath,
    fn: async ({ path, event }) => {
      const auth = customerAuth(event);
      const role = requireSearchAccess(auth, path.searchId);
      const existing = await repo.getRating(path.listingId, auth.userId);
      if (!existing || existing.searchId !== path.searchId) {
        throw ApiError.notFound("Rating");
      }
      await repo.deleteRating(path.listingId, auth.userId);
      const meta = await repo.getListingMeta(path.listingId);
      await publishEvents(EVENT_SOURCES.engagement, {
        type: "rating.removed",
        searchId: path.searchId,
        listingId: path.listingId,
        actorId: auth.userId,
        actorName: auth.displayName,
        actorRole: role,
        at: nowIso(),
        summary: `${auth.displayName} removed their rating of "${meta?.title ?? "a listing"}"`
      });
      return { status: 204 };
    }
  }),

  "GET /api/v1/searches/{searchId}/comments": apiHandler({
    path: searchPath,
    query: commentsQuery,
    fn: async ({ path, query, event }) => {
      const auth = customerAuth(event);
      requireSearchAccess(auth, path.searchId);
      const comments = await repo.listComments(path.searchId);
      return { body: paginateOffset(comments, query.limit, query.cursor) };
    }
  }),

  "POST /api/v1/searches/{searchId}/comments": apiHandler({
    path: searchPath,
    body: commentCreateSchema,
    fn: async ({ path, body, event }) => {
      const auth = customerAuth(event);
      const role = requireSearchAccess(auth, path.searchId);
      let listingTitle: string | null = null;
      if (body.listingId) {
        const meta = await repo.requireListingActive(body.listingId, {
          mustBePublished: true
        });
        listingTitle = meta.title;
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
        authorId: auth.userId,
        authorName: auth.displayName,
        authorRole: role,
        body: body.body,
        createdAt: nowIso(),
        deletedAt: null
      };
      await repo.putComment(comment);
      await publishEvents(EVENT_SOURCES.engagement, {
        type: "comment.created",
        searchId: path.searchId,
        listingId: body.listingId ?? undefined,
        actorId: auth.userId,
        actorName: auth.displayName,
        actorRole: role,
        at: comment.createdAt,
        summary: listingTitle
          ? `${auth.displayName} commented on "${listingTitle}"`
          : `${auth.displayName} commented on the search`,
        payload: { commentId: comment.id, parentId: comment.parentId }
      });
      return { status: 201, body: comment };
    }
  })
});
