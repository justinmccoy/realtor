import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand
} from "@aws-sdk/lib-dynamodb";
import { ddb, nowIso, tableName } from "@jj/lambda-kit";
import {
  ApiError,
  commentSchema,
  ratingSchema,
  type Comment,
  type Rating
} from "@jj/shared";
import {
  engagementKeys,
  SEARCH_RATINGS_INDEX,
  type ListingMeta
} from "./keys.js";

const T = (): string => tableName("ENGAGEMENT_TABLE");

/* ---------- event-carried listing state ---------- */

export async function setListingMeta(
  listingId: string,
  meta: ListingMeta
): Promise<void> {
  await ddb().send(
    new PutCommand({
      TableName: T(),
      Item: { ...engagementKeys.listingMeta(listingId), ...meta }
    })
  );
}

export async function deleteListingMeta(listingId: string): Promise<void> {
  await ddb().send(
    new DeleteCommand({ TableName: T(), Key: engagementKeys.listingMeta(listingId) })
  );
}

export async function getListingMeta(
  listingId: string
): Promise<ListingMeta | null> {
  const res = await ddb().send(
    new GetCommand({ TableName: T(), Key: engagementKeys.listingMeta(listingId) })
  );
  return res.Item
    ? {
        searchId: String(res.Item.searchId),
        title: String(res.Item.title ?? ""),
        published: Boolean(res.Item.published)
      }
    : null;
}

/** Guards customer writes: the listing must belong to the search, and (for
 *  customers) be published. Meta arrives via events, so a listing created
 *  moments ago may not be visible yet — surfaced as not_found, retryable. */
export async function requireListingInSearch(
  listingId: string,
  searchId: string,
  opts: { mustBePublished: boolean }
): Promise<ListingMeta> {
  const meta = await getListingMeta(listingId);
  if (!meta || meta.searchId !== searchId) {
    throw ApiError.notFound("Listing");
  }
  if (opts.mustBePublished && !meta.published) {
    throw ApiError.forbidden("Listing is not available");
  }
  return meta;
}

/* ---------- ratings ---------- */

export function itemToRating(item: Record<string, unknown>): Rating {
  return ratingSchema.parse(item);
}

export async function putRating(rating: Rating): Promise<void> {
  await ddb().send(
    new PutCommand({
      TableName: T(),
      Item: {
        ...engagementKeys.rating(rating.listingId, rating.userId),
        ...engagementKeys.ratingGsi(
          rating.searchId,
          rating.listingId,
          rating.userId
        ),
        ...rating
      }
    })
  );
}

export async function getRating(
  listingId: string,
  userId: string
): Promise<Rating | null> {
  const res = await ddb().send(
    new GetCommand({ TableName: T(), Key: engagementKeys.rating(listingId, userId) })
  );
  return res.Item ? itemToRating(res.Item) : null;
}

export async function deleteRating(
  listingId: string,
  userId: string
): Promise<void> {
  await ddb().send(
    new DeleteCommand({ TableName: T(), Key: engagementKeys.rating(listingId, userId) })
  );
}

export async function listRatingsBySearch(searchId: string): Promise<Rating[]> {
  const res = await ddb().send(
    new QueryCommand({
      TableName: T(),
      IndexName: SEARCH_RATINGS_INDEX,
      KeyConditionExpression: "GSI1PK = :p AND begins_with(GSI1SK, :s)",
      ExpressionAttributeValues: {
        ":p": `SEARCH#${searchId}`,
        ":s": "RATING#"
      }
    })
  );
  return (res.Items ?? []).map(itemToRating);
}

export async function listRatingsByListing(listingId: string): Promise<Rating[]> {
  const res = await ddb().send(
    new QueryCommand({
      TableName: T(),
      KeyConditionExpression: "PK = :p AND begins_with(SK, :s)",
      ExpressionAttributeValues: {
        ":p": `LISTING#${listingId}`,
        ":s": "RATING#"
      }
    })
  );
  return (res.Items ?? []).map(itemToRating);
}

export async function deleteRatingsForListing(listingId: string): Promise<void> {
  for (const r of await listRatingsByListing(listingId)) {
    await deleteRating(listingId, r.userId);
  }
}

/* ---------- comments ---------- */

export function itemToComment(item: Record<string, unknown>): Comment {
  return commentSchema.parse({ deletedAt: null, ...item });
}

export async function putComment(comment: Comment): Promise<void> {
  await ddb().send(
    new PutCommand({
      TableName: T(),
      Item: { ...engagementKeys.comment(comment.searchId, comment.id), ...comment }
    })
  );
}

export async function getComment(
  searchId: string,
  commentId: string
): Promise<Comment | null> {
  const res = await ddb().send(
    new GetCommand({ TableName: T(), Key: engagementKeys.comment(searchId, commentId) })
  );
  return res.Item ? itemToComment(res.Item) : null;
}

/** Newest-first. Soft-deleted comments keep their place with a blank body so
 *  threads stay intact. */
export async function listComments(searchId: string): Promise<Comment[]> {
  const items: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await ddb().send(
      new QueryCommand({
        TableName: T(),
        KeyConditionExpression: "PK = :p AND begins_with(SK, :s)",
        ExpressionAttributeValues: {
          ":p": `SEARCH#${searchId}`,
          ":s": "COMMENT#"
        },
        ScanIndexForward: false,
        ExclusiveStartKey: lastKey
      })
    );
    items.push(...(res.Items ?? []));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey && items.length < 5000);
  return items.map(itemToComment);
}

export async function softDeleteComment(
  searchId: string,
  commentId: string
): Promise<Comment> {
  const existing = await getComment(searchId, commentId);
  if (!existing) throw ApiError.notFound("Comment");
  const redacted: Comment = { ...existing, body: "", deletedAt: nowIso() };
  await putComment(redacted);
  return redacted;
}
