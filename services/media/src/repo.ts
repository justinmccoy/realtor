import {
  BatchGetCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import { ddb, tableName } from "@jj/lambda-kit";
import { ApiError, photoSchema, type Photo, type PhotoKind } from "@jj/shared";
import { mediaKeys, SEARCH_PHOTOS_INDEX } from "./keys.js";

const T = (): string => tableName("MEDIA_TABLE");

export function itemToPhoto(item: Record<string, unknown>): Photo {
  return photoSchema.parse(item);
}

function photoItem(p: Photo): Record<string, unknown> {
  return {
    ...mediaKeys.photo(p.listingId, p.id),
    ...mediaKeys.photoGsi(p.searchId, p.listingId, p.id),
    ...p
  };
}

export async function putPhoto(p: Photo): Promise<void> {
  await ddb().send(new PutCommand({ TableName: T(), Item: photoItem(p) }));
}

export async function getPhoto(
  listingId: string,
  photoId: string
): Promise<Photo | null> {
  const res = await ddb().send(
    new GetCommand({ TableName: T(), Key: mediaKeys.photo(listingId, photoId) })
  );
  return res.Item ? itemToPhoto(res.Item) : null;
}

export async function requirePhoto(
  listingId: string,
  photoId: string
): Promise<Photo> {
  const p = await getPhoto(listingId, photoId);
  if (!p) throw ApiError.notFound("Photo");
  return p;
}

export async function deletePhoto(
  listingId: string,
  photoId: string
): Promise<void> {
  await ddb().send(
    new DeleteCommand({ TableName: T(), Key: mediaKeys.photo(listingId, photoId) })
  );
}

export async function listByListing(listingId: string): Promise<Photo[]> {
  const res = await ddb().send(
    new QueryCommand({
      TableName: T(),
      KeyConditionExpression: "PK = :p AND begins_with(SK, :s)",
      ExpressionAttributeValues: {
        ":p": `LISTING#${listingId}`,
        ":s": "PHOTO#"
      }
    })
  );
  return (res.Items ?? [])
    .map(itemToPhoto)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function listBySearch(searchId: string): Promise<Photo[]> {
  const items: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await ddb().send(
      new QueryCommand({
        TableName: T(),
        IndexName: SEARCH_PHOTOS_INDEX,
        KeyConditionExpression: "GSI1PK = :p",
        ExpressionAttributeValues: { ":p": `SEARCH#${searchId}` },
        ExclusiveStartKey: lastKey
      })
    );
    items.push(...(res.Items ?? []));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey && items.length < 5000);
  return items.map(itemToPhoto).sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function nextSortOrder(listingId: string): Promise<number> {
  const photos = await listByListing(listingId);
  return photos.length ? Math.max(...photos.map((p) => p.sortOrder)) + 1 : 0;
}

export async function markReady(
  listingId: string,
  photoId: string
): Promise<Photo> {
  const photo = await requirePhoto(listingId, photoId);
  const ready: Photo = { ...photo, status: "ready" };
  await putPhoto(ready);
  return ready;
}

/** Validates ownership and applies the new order; ids must exactly cover the
 *  listing's photos of that kind. */
export async function reorder(
  listingId: string,
  kind: PhotoKind,
  orderedIds: string[]
): Promise<Photo[]> {
  const photos = (await listByListing(listingId)).filter((p) => p.kind === kind);
  const current = new Set(photos.map((p) => p.id));
  if (
    orderedIds.length !== current.size ||
    !orderedIds.every((id) => current.has(id))
  ) {
    throw ApiError.badRequest(
      "orderedIds must contain exactly the listing's photo ids of this kind"
    );
  }
  const byId = new Map(photos.map((p) => [p.id, p]));
  const updated: Photo[] = [];
  for (let i = 0; i < orderedIds.length; i++) {
    const photo = byId.get(orderedIds[i]!)!;
    if (photo.sortOrder !== i) {
      const next = { ...photo, sortOrder: i };
      await putPhoto(next);
      updated.push(next);
    } else {
      updated.push(photo);
    }
  }
  return updated.sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Removes all photo items for a listing (and its META); returns S3 keys. */
export async function deleteAllForListing(listingId: string): Promise<string[]> {
  const photos = await listByListing(listingId);
  for (const p of photos) await deletePhoto(listingId, p.id);
  await ddb().send(
    new DeleteCommand({ TableName: T(), Key: mediaKeys.listingMeta(listingId) })
  );
  return photos.map((p) => p.s3Key);
}

/* ---------- event-carried listing visibility ---------- */

export async function setPublished(
  listingId: string,
  searchId: string,
  published: boolean
): Promise<void> {
  await ddb().send(
    new UpdateCommand({
      TableName: T(),
      Key: mediaKeys.listingMeta(listingId),
      UpdateExpression: "SET published = :p, searchId = :s",
      ExpressionAttributeValues: { ":p": published, ":s": searchId }
    })
  );
}

/** listingId -> published (missing META = never published = false). */
export async function publishedMap(
  listingIds: string[]
): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  const unique = [...new Set(listingIds)];
  for (const id of unique) out[id] = false;
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const res = await ddb().send(
      new BatchGetCommand({
        RequestItems: {
          [T()]: { Keys: chunk.map((id) => mediaKeys.listingMeta(id)) }
        }
      })
    );
    for (const item of res.Responses?.[T()] ?? []) {
      const pk = String(item.PK ?? "");
      out[pk.replace("LISTING#", "")] = Boolean(item.published);
    }
  }
  return out;
}
