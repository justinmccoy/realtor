import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import { ddb, newId, tableName } from "@jj/lambda-kit";
import {
  activityRecordSchema,
  decodeCursor,
  encodeCursor,
  listingEngagementSchema,
  type ActivityRecord,
  type ListingEngagement,
  type Page
} from "@jj/shared";
import { ttlEpoch } from "./domain.js";

const T = (): string => tableName("ACTIVITY_TABLE");

/* Key layout:
 *  Feed:    PK SEARCH#<sid>  / SK EVENT#<at>#<eid>     (TTL 180d)
 *           GSI1PK ACTOR#<userId> / GSI1SK <at>#<eid>
 *           GSI2PK FEED          / GSI2SK <at>#<eid>   (global recent feed)
 *  Audit:   PK AUDIT          / SK <at>#<eid>          (no TTL)
 *  Rollup:  PK SEARCH#<sid>   / SK ROLLUP#<listingId>  (engagement counters) */

export function itemToRecord(item: Record<string, unknown>): ActivityRecord {
  return activityRecordSchema.parse({
    searchId: null,
    listingId: null,
    payload: null,
    ...item
  });
}

export async function putActivity(record: ActivityRecord): Promise<void> {
  if (!record.searchId) return; // feed records are always search-scoped
  await ddb().send(
    new PutCommand({
      TableName: T(),
      Item: {
        PK: `SEARCH#${record.searchId}`,
        SK: `EVENT#${record.at}#${record.id}`,
        GSI1PK: `ACTOR#${record.actorId}`,
        GSI1SK: `${record.at}#${record.id}`,
        GSI2PK: "FEED",
        GSI2SK: `${record.at}#${record.id}`,
        expiresAt: ttlEpoch(Date.now()),
        ...record
      }
    })
  );
}

export interface AuditInput {
  at: string;
  adminId: string;
  adminName: string;
  action: string;
  entity: string;
  entityId: string;
  searchId: string | null;
  summary: string;
  before: unknown;
  after: unknown;
}

const capJson = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = JSON.stringify(v);
  return s.length > 4096 ? `${s.slice(0, 4093)}…` : s;
};

export async function putAudit(input: AuditInput): Promise<void> {
  const id = newId();
  await ddb().send(
    new PutCommand({
      TableName: T(),
      Item: {
        PK: "AUDIT",
        SK: `${input.at}#${id}`,
        id,
        at: input.at,
        adminId: input.adminId,
        adminName: input.adminName,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        searchId: input.searchId,
        summary: input.summary,
        before: capJson(input.before),
        after: capJson(input.after)
      }
    })
  );
}

interface RangeQuery {
  limit: number;
  cursor?: string;
  from?: string;
  to?: string;
}

async function queryRange(
  key: { attr: "PK" | "GSI1PK" | "GSI2PK"; value: string },
  skAttr: "SK" | "GSI1SK" | "GSI2SK",
  q: RangeQuery,
  skPrefix?: string
): Promise<Page<Record<string, unknown>>> {
  const names: Record<string, string> = { "#pk": key.attr };
  const values: Record<string, unknown> = { ":pk": key.value };
  let skCond = "";
  const lo = q.from ? `${skPrefix ?? ""}${q.from}` : undefined;
  const hi = q.to ? `${skPrefix ?? ""}${q.to}#￿` : undefined;
  if (lo && hi) {
    skCond = " AND #sk BETWEEN :lo AND :hi";
    values[":lo"] = lo;
    values[":hi"] = hi;
  } else if (lo) {
    skCond = " AND #sk >= :lo";
    values[":lo"] = lo;
  } else if (hi) {
    skCond = " AND #sk <= :hi";
    values[":hi"] = hi;
  } else if (skPrefix) {
    skCond = " AND begins_with(#sk, :pre)";
    values[":pre"] = skPrefix;
  }
  if (skCond) names["#sk"] = skAttr;
  const index =
    key.attr === "GSI1PK" ? "GSI1" : key.attr === "GSI2PK" ? "GSI2" : undefined;
  const res = await ddb().send(
    new QueryCommand({
      TableName: T(),
      IndexName: index,
      KeyConditionExpression: `#pk = :pk${skCond}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ScanIndexForward: false,
      Limit: q.limit,
      ExclusiveStartKey: decodeCursor(q.cursor)
    })
  );
  return {
    items: res.Items ?? [],
    nextCursor: encodeCursor(res.LastEvaluatedKey)
  };
}

export async function feedBySearch(
  searchId: string,
  q: RangeQuery
): Promise<Page<ActivityRecord>> {
  const page = await queryRange(
    { attr: "PK", value: `SEARCH#${searchId}` },
    "SK",
    q,
    "EVENT#"
  );
  return { items: page.items.map(itemToRecord), nextCursor: page.nextCursor };
}

export async function feedByActor(
  actorId: string,
  q: RangeQuery
): Promise<Page<ActivityRecord>> {
  const page = await queryRange(
    { attr: "GSI1PK", value: `ACTOR#${actorId}` },
    "GSI1SK",
    q
  );
  return { items: page.items.map(itemToRecord), nextCursor: page.nextCursor };
}

export async function feedGlobal(q: RangeQuery): Promise<Page<ActivityRecord>> {
  const page = await queryRange({ attr: "GSI2PK", value: "FEED" }, "GSI2SK", q);
  return { items: page.items.map(itemToRecord), nextCursor: page.nextCursor };
}

export async function auditLog(
  q: RangeQuery
): Promise<Page<Record<string, unknown>>> {
  return queryRange({ attr: "PK", value: "AUDIT" }, "SK", q);
}

/* ---------- engagement rollups ---------- */

export async function bumpRollup(
  searchId: string,
  listingId: string,
  field: "expands" | "photoViews" | "exposeClicks" | "mapClicks",
  at: string
): Promise<void> {
  await ddb().send(
    new UpdateCommand({
      TableName: T(),
      Key: { PK: `SEARCH#${searchId}`, SK: `ROLLUP#${listingId}` },
      UpdateExpression:
        "ADD #f :one SET listingId = :lid, lastViewedAt = :at",
      ExpressionAttributeNames: { "#f": field },
      ExpressionAttributeValues: { ":one": 1, ":lid": listingId, ":at": at }
    })
  );
}

export async function engagementForSearch(
  searchId: string
): Promise<ListingEngagement[]> {
  const res = await ddb().send(
    new QueryCommand({
      TableName: T(),
      KeyConditionExpression: "PK = :p AND begins_with(SK, :s)",
      ExpressionAttributeValues: {
        ":p": `SEARCH#${searchId}`,
        ":s": "ROLLUP#"
      }
    })
  );
  return (res.Items ?? []).map((item) =>
    listingEngagementSchema.parse({
      expands: 0,
      photoViews: 0,
      exposeClicks: 0,
      mapClicks: 0,
      lastViewedAt: null,
      ...item
    })
  );
}

export async function getRollup(
  searchId: string,
  listingId: string
): Promise<ListingEngagement | null> {
  const res = await ddb().send(
    new GetCommand({
      TableName: T(),
      Key: { PK: `SEARCH#${searchId}`, SK: `ROLLUP#${listingId}` }
    })
  );
  return res.Item
    ? listingEngagementSchema.parse({
        expands: 0,
        photoViews: 0,
        exposeClicks: 0,
        mapClicks: 0,
        lastViewedAt: null,
        ...res.Item
      })
    : null;
}
