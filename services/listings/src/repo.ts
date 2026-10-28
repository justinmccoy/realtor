import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand
} from "@aws-sdk/lib-dynamodb";
import { ddb, newId, nowIso, tableName } from "@jj/lambda-kit";
import {
  ApiError,
  listingSchema,
  sourceSchema,
  type Listing,
  type ListingCreateInput,
  type ListingUpdateInput,
  type Source,
  type SourceStatus
} from "@jj/shared";
import { buildListing, mergeListing } from "./domain.js";
import { listingKeys, VIEWING_INDEX } from "./keys.js";

const T = (): string => tableName("LISTING_TABLE");

export function itemToListing(item: Record<string, unknown>): Listing {
  return listingSchema.parse(item);
}

export function itemToSource(item: Record<string, unknown>): Source {
  return sourceSchema.parse(item);
}

function listingItem(l: Listing): Record<string, unknown> {
  return {
    ...listingKeys.listing(l.searchId, l.id),
    // Sparse viewings index: keys exist only while a viewing is booked.
    ...(l.viewingAt ? listingKeys.viewingGsi(l.viewingAt, l.id) : {}),
    ...l
  };
}

async function queryPartition(
  searchId: string,
  skPrefix: "LISTING#" | "SOURCE#"
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await ddb().send(
      new QueryCommand({
        TableName: T(),
        KeyConditionExpression: "PK = :p AND begins_with(SK, :s)",
        ExpressionAttributeValues: {
          ":p": `SEARCH#${searchId}`,
          ":s": skPrefix
        },
        ExclusiveStartKey: lastKey
      })
    );
    items.push(...(res.Items ?? []));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey && items.length < 2000);
  return items;
}

/* ---------- listings ---------- */

export async function listAll(searchId: string): Promise<Listing[]> {
  return (await queryPartition(searchId, "LISTING#")).map(itemToListing);
}

export async function getListing(
  searchId: string,
  listingId: string
): Promise<Listing | null> {
  const res = await ddb().send(
    new GetCommand({ TableName: T(), Key: listingKeys.listing(searchId, listingId) })
  );
  return res.Item ? itemToListing(res.Item) : null;
}

export async function requireListing(
  searchId: string,
  listingId: string
): Promise<Listing> {
  const l = await getListing(searchId, listingId);
  if (!l) throw ApiError.notFound("Listing");
  return l;
}

/** Only one benchmark and one holder of each top-5 rank per search. */
async function enforceExclusivity(saved: Listing): Promise<void> {
  if (!saved.benchmark && saved.topRank === 0) return;
  const others = (await listAll(saved.searchId)).filter((l) => l.id !== saved.id);
  for (const other of others) {
    const clearBenchmark = saved.benchmark && other.benchmark;
    const clearRank = saved.topRank > 0 && other.topRank === saved.topRank;
    if (!clearBenchmark && !clearRank) continue;
    await putListing({
      ...other,
      benchmark: clearBenchmark ? false : other.benchmark,
      topRank: clearRank ? 0 : other.topRank,
      updatedAt: nowIso()
    });
  }
}

async function putListing(l: Listing): Promise<void> {
  // Put replaces the whole item, so clearing a viewing also drops the item
  // out of the sparse viewings index (listingItem omits the GSI keys then).
  await ddb().send(new PutCommand({ TableName: T(), Item: listingItem(l) }));
}

export async function createListing(
  searchId: string,
  input: ListingCreateInput
): Promise<Listing> {
  const listing = buildListing(searchId, input, newId(), nowIso());
  await putListing(listing);
  await enforceExclusivity(listing);
  return listing;
}

export async function updateListing(
  searchId: string,
  listingId: string,
  input: ListingUpdateInput
): Promise<{ before: Listing; after: Listing }> {
  const before = await requireListing(searchId, listingId);
  const after = mergeListing(before, input, nowIso());
  await putListing(after);
  await enforceExclusivity(after);
  return { before, after };
}

export async function deleteListing(
  searchId: string,
  listingId: string
): Promise<Listing> {
  const existing = await requireListing(searchId, listingId);
  await ddb().send(
    new DeleteCommand({ TableName: T(), Key: listingKeys.listing(searchId, listingId) })
  );
  // Unlink any inbox source pointing at it.
  const sources = await listSources(searchId);
  for (const s of sources) {
    if (s.listingId === listingId) {
      await putSource({ ...s, listingId: null, status: "pending" });
    }
  }
  return existing;
}

/** Upcoming viewings across every search (admin dashboard). */
export async function upcomingViewings(days: number): Promise<Listing[]> {
  const now = new Date();
  const until = new Date(now.getTime() + days * 86_400_000);
  const res = await ddb().send(
    new QueryCommand({
      TableName: T(),
      IndexName: VIEWING_INDEX,
      KeyConditionExpression: "GSI1PK = :p AND GSI1SK BETWEEN :from AND :to",
      ExpressionAttributeValues: {
        ":p": "VIEWING",
        ":from": now.toISOString(),
        ":to": `${until.toISOString()}#￿`
      }
    })
  );
  return (res.Items ?? []).map(itemToListing);
}

/* ---------- link inbox ---------- */

async function putSource(s: Source): Promise<void> {
  await ddb().send(
    new PutCommand({
      TableName: T(),
      Item: { ...listingKeys.source(s.searchId, s.id), ...s }
    })
  );
}

export async function listSources(searchId: string): Promise<Source[]> {
  return (await queryPartition(searchId, "SOURCE#"))
    .map(itemToSource)
    .sort((a, b) => b.id.localeCompare(a.id));
}

/** Adds URLs to the inbox, skipping ones already present. */
export async function addSources(
  searchId: string,
  urls: string[]
): Promise<Source[]> {
  const existing = new Set((await listSources(searchId)).map((s) => s.url));
  const created: Source[] = [];
  for (const url of urls) {
    if (existing.has(url)) continue;
    existing.add(url);
    const source: Source = {
      id: newId(),
      searchId,
      url,
      status: "pending",
      listingId: null,
      addedAt: nowIso()
    };
    await putSource(source);
    created.push(source);
  }
  return created;
}

export async function getSource(
  searchId: string,
  sourceId: string
): Promise<Source | null> {
  const res = await ddb().send(
    new GetCommand({ TableName: T(), Key: listingKeys.source(searchId, sourceId) })
  );
  return res.Item ? itemToSource(res.Item) : null;
}

export async function updateSource(
  searchId: string,
  sourceId: string,
  patch: { status?: SourceStatus; listingId?: string | null }
): Promise<Source> {
  const existing = await getSource(searchId, sourceId);
  if (!existing) throw ApiError.notFound("Inbox link");
  const updated: Source = {
    ...existing,
    status: patch.status ?? existing.status,
    listingId: patch.listingId === undefined ? existing.listingId : patch.listingId
  };
  await putSource(updated);
  return updated;
}

export async function deleteSource(
  searchId: string,
  sourceId: string
): Promise<void> {
  await ddb().send(
    new DeleteCommand({ TableName: T(), Key: listingKeys.source(searchId, sourceId) })
  );
}
