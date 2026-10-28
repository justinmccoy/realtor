import { z } from "zod";
import { PHOTO_KINDS } from "../constants.js";

export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp"
] as const;

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export const presignRequestSchema = z.object({
  kind: z.enum(PHOTO_KINDS).default("photo"),
  contentType: z.enum(ALLOWED_IMAGE_TYPES),
  /** Original file name, for admin display only — never used as the S3 key. */
  fileName: z.string().max(255).optional()
});
export type PresignRequest = z.infer<typeof presignRequestSchema>;

export const presignResponseSchema = z.object({
  photoId: z.string().ulid(),
  uploadUrl: z.string().url(),
  /** Client must send exactly these headers with the PUT. */
  headers: z.record(z.string()),
  expiresInSeconds: z.number()
});
export type PresignResponse = z.infer<typeof presignResponseSchema>;

export const photoConfirmSchema = z.object({
  photoId: z.string().ulid()
});

export const photoSchema = z.object({
  id: z.string().ulid(),
  listingId: z.string().ulid(),
  searchId: z.string().ulid(),
  kind: z.enum(PHOTO_KINDS),
  s3Key: z.string(),
  contentType: z.string(),
  sortOrder: z.number().int(),
  status: z.enum(["pending", "ready"]),
  createdAt: z.string().datetime()
});
export type Photo = z.infer<typeof photoSchema>;

export const photoReorderSchema = z.object({
  orderedIds: z.array(z.string().ulid()).min(1).max(100)
});
