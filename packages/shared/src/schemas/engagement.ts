import { z } from "zod";

export const ratingPutSchema = z.object({
  score: z.number().int().min(1).max(5),
  comment: z.string().max(2000).default("")
});
export type RatingPutInput = z.infer<typeof ratingPutSchema>;

export const ratingSchema = z.object({
  listingId: z.string().ulid(),
  searchId: z.string().ulid(),
  userId: z.string(),
  authorName: z.string(),
  score: z.number().int().min(1).max(5),
  comment: z.string(),
  updatedAt: z.string().datetime()
});
export type Rating = z.infer<typeof ratingSchema>;

export const commentCreateSchema = z.object({
  /** null = comment on the search as a whole (the Discussion panel). */
  listingId: z.string().ulid().nullable().default(null),
  /** Set to reply within a thread. */
  parentId: z.string().ulid().nullable().default(null),
  body: z.string().min(1).max(4000)
});
export type CommentCreateInput = z.infer<typeof commentCreateSchema>;

export const commentSchema = z.object({
  id: z.string().ulid(),
  searchId: z.string().ulid(),
  listingId: z.string().ulid().nullable(),
  parentId: z.string().ulid().nullable(),
  authorId: z.string(),
  authorName: z.string(),
  authorRole: z.enum(["admin", "client", "viewer"]),
  body: z.string(),
  createdAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable()
});
export type Comment = z.infer<typeof commentSchema>;
