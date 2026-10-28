import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand
} from "@aws-sdk/lib-dynamodb";
import { ddb, newId, nowIso, tableName } from "@jj/lambda-kit";
import {
  ApiError,
  briefSchema,
  listingSchema,
  settingsSchema,
  sourceSchema,
  visibility,
  type Brief,
  type Listing,
  type ListingCreateInput,
  type ListingUpdateInput,
  type Settings,
  type ShareMode,
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
    ...listingKeys.listing(l.id),
    // Sparse viewings index: keys exist only while a viewing is booked.
    ...(l.viewingAt ? listingKeys.viewingGsi(l.viewingAt, l.id) : {}),
    ...l
  };
}

async function queryPool(
  skPrefix: "LISTING#" | "SOURCE#"
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await ddb().send(
      new QueryCommand({
        TableName: T(),
        KeyConditionExpression: "PK = :p AND begins_with(SK, :s)",
        ExpressionAttributeValues: { ":p": "POOL", ":s": skPrefix },
        ExclusiveStartKey: lastKey
      })
    );
    items.push(...(res.Items ?? []));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey && items.length < 5000);
  return items;
}

/* ---------- listings (global pool) ---------- */

export async function listAll(): Promise<Listing[]> {
  return (await queryPool("LISTING#")).map(itemToListing);
}

export async function getListing(listingId: string): Promise<Listing | null> {
  const res = await ddb().send(
    new GetCommand({ TableName: T(), Key: listingKeys.listing(listingId) })
  );
  return res.Item ? itemToListing(res.Item) : null;
}

export async function requireListing(listingId: string): Promise<Listing> {
  const l = await getListing(listingId);
  if (!l) throw ApiError.notFound("Listing");
  return l;
}

/** Only one benchmark and one holder of each top-5 rank across the pool. */
async function enforceExclusivity(saved: Listing): Promise<void> {
  if (!saved.benchmark && saved.topRank === 0) return;
  const others = (await listAll()).filter((l) => l.id !== saved.id);
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
  await ddb().send(new PutCommand({ TableName: T(), Item: listingItem(l) }));
}

export async function createListing(input: ListingCreateInput): Promise<Listing> {
  const listing = buildListing(input, newId(), nowIso());
  await putListing(listing);
  await enforceExclusivity(listing);
  return listing;
}

export async function updateListing(
  listingId: string,
  input: ListingUpdateInput
): Promise<{ before: Listing; after: Listing }> {
  const before = await requireListing(listingId);
  const after = mergeListing(before, input, nowIso());
  await putListing(after);
  await enforceExclusivity(after);
  return { before, after };
}

export async function deleteListing(listingId: string): Promise<Listing> {
  const existing = await requireListing(listingId);
  await ddb().send(
    new DeleteCommand({ TableName: T(), Key: listingKeys.listing(listingId) })
  );
  // Unlink any inbox source pointing at it (share overrides are filtered on
  // read against the pool, so orphans are harmless).
  for (const s of await listSources()) {
    if (s.listingId === listingId) {
      await putSource({ ...s, listingId: null, status: "pending" });
    }
  }
  return existing;
}

/** Upcoming viewings across the pool (admin dashboard). */
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

/* ---------- per-search visibility ---------- */

export interface Criteria {
  brief: Brief;
  settings: Settings;
  status: string;
}

export async function putCriteria(
  searchId: string,
  input: { brief?: unknown; settings?: unknown; status?: unknown }
): Promise<void> {
  const existing = await getCriteria(searchId);
  await ddb().send(
    new PutCommand({
      TableName: T(),
      Item: {
        ...listingKeys.criteria(searchId),
        brief: input.brief ?? existing?.brief ?? briefSchema.parse({}),
        settings: input.settings ?? existing?.settings ?? settingsSchema.parse({}),
        status: input.status ?? existing?.status ?? "active"
      }
    })
  );
}

export async function getCriteria(searchId: string): Promise<Criteria | null> {
  const res = await ddb().send(
    new GetCommand({ TableName: T(), Key: listingKeys.criteria(searchId) })
  );
  if (!res.Item) return null;
  return {
    brief: briefSchema.parse(res.Item.brief ?? {}),
    settings: settingsSchema.parse(res.Item.settings ?? {}),
    status: String(res.Item.status ?? "active")
  };
}

export async function putShare(
  searchId: string,
  listingId: string,
  mode: ShareMode
): Promise<void> {
  await ddb().send(
    new PutCommand({
      TableName: T(),
      Item: {
        ...listingKeys.share(searchId, listingId),
        searchId,
        listingId,
        mode,
        at: nowIso()
      }
    })
  );
}

export async function clearShare(searchId: string, listingId: string): Promise<void> {
  await ddb().send(
    new DeleteCommand({ TableName: T(), Key: listingKeys.share(searchId, listingId) })
  );
}

/** listingId -> override for one search. */
export async function listShares(searchId: string): Promise<Map<string, ShareMode>> {
  const res = await ddb().send(
    new QueryCommand({
      TableName: T(),
      KeyConditionExpression: "PK = :p AND begins_with(SK, :s)",
      ExpressionAttributeValues: { ":p": `SEARCH#${searchId}`, ":s": "SHARE#" }
    })
  );
  const map = new Map<string, ShareMode>();
  for (const item of res.Items ?? []) {
    map.set(String(item.listingId), item.mode as ShareMode);
  }
  return map;
}

/** The listings a client of this search may see, with the reason attached. */
export async function visibleForSearch(
  searchId: string
): Promise<{ listing: Listing; reason: "shared" | "match" }[]> {
  const [pool, shares, criteria] = await Promise.all([
    listAll(),
    listShares(searchId),
    getCriteria(searchId)
  ]);
  const brief = criteria?.brief ?? briefSchema.parse({});
  const settings = criteria?.settings ?? settingsSchema.parse({});
  const out: { listing: Listing; reason: "shared" | "match" }[] = [];
  for (const listing of pool) {
    const v = visibility(listing, brief, settings, shares.get(listing.id));
    if (v.visible) {
      out.push({ listing, reason: v.reason as "shared" | "match" });
    }
  }
  return out;
}

/* ---------- link inbox (global) ---------- */

async function putSource(s: Source): Promise<void> {
  await ddb().send(
    new PutCommand({ TableName: T(), Item: { ...listingKeys.source(s.id), ...s } })
  );
}

export async function listSources(): Promise<Source[]> {
  return (await queryPool("SOURCE#"))
    .map(itemToSource)
    .sort((a, b) => b.id.localeCompare(a.id));
}

export async function addSources(urls: string[]): Promise<Source[]> {
  const existing = new Set((await listSources()).map((s) => s.url));
  const created: Source[] = [];
  for (const url of urls) {
    if (existing.has(url)) continue;
    existing.add(url);
    const source: Source = {
      id: newId(),
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

export async function getSource(sourceId: string): Promise<Source | null> {
  const res = await ddb().send(
    new GetCommand({ TableName: T(), Key: listingKeys.source(sourceId) })
  );
  return res.Item ? itemToSource(res.Item) : null;
}

export async function updateSource(
  sourceId: string,
  patch: { status?: SourceStatus; listingId?: string | null }
): Promise<Source> {
  const existing = await getSource(sourceId);
  if (!existing) throw ApiError.notFound("Inbox link");
  const updated: Source = {
    ...existing,
    status: patch.status ?? existing.status,
    listingId: patch.listingId === undefined ? existing.listingId : patch.listingId
  };
  await putSource(updated);
  return updated;
}

export async function deleteSource(sourceId: string): Promise<void> {
  await ddb().send(
    new DeleteCommand({ TableName: T(), Key: listingKeys.source(sourceId) })
  );
}
