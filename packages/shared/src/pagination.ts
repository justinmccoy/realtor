import { z } from "zod";
import { ApiError } from "./errors.js";

export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(4096).optional()
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Opaque cursor wrapping DynamoDB's LastEvaluatedKey. */
export function encodeCursor(
  key: Record<string, unknown> | undefined
): string | null {
  if (!key) return null;
  return Buffer.from(JSON.stringify(key), "utf8").toString("base64url");
}

/**
 * Offset-based pagination over an in-memory result set. Used where results
 * are filtered/sorted after a full partition read (a DynamoDB key cursor
 * cannot paginate a price-sorted list); partitions are capped at a few
 * hundred items in this system.
 */
export function paginateOffset<T>(
  items: T[],
  limit: number,
  cursor: string | undefined
): Page<T> {
  let offset = 0;
  if (cursor) {
    const parsed = Number.parseInt(
      Buffer.from(cursor, "base64url").toString("utf8"),
      10
    );
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw ApiError.badRequest("Invalid pagination cursor");
    }
    offset = parsed;
  }
  const page = items.slice(offset, offset + limit);
  const next = offset + limit < items.length ? offset + limit : null;
  return {
    items: page,
    nextCursor:
      next === null
        ? null
        : Buffer.from(String(next), "utf8").toString("base64url")
  };
}

export function decodeCursor(
  cursor: string | undefined
): Record<string, unknown> | undefined {
  if (!cursor) return undefined;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8")
    );
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw ApiError.badRequest("Invalid pagination cursor");
  }
}
