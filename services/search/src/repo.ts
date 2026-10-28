import {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import { ddb, newId, nowIso, tableName } from "@jj/lambda-kit";
import {
  ApiError,
  briefSchema,
  encodeCursor,
  decodeCursor,
  memberSchema,
  searchSchema,
  settingsSchema,
  type Brief,
  type Member,
  type MemberRole,
  type Page,
  type Search,
  type SearchCreateInput,
  type SearchUpdateInput
} from "@jj/shared";
import { searchKeys } from "./keys.js";

const T = (): string => tableName("SEARCH_TABLE");

/* ---------- pure builders (unit-tested) ---------- */

export function buildSearch(
  input: SearchCreateInput,
  id: string,
  now: string
): Search {
  return {
    id,
    clientName: input.clientName,
    status: "active",
    settings: settingsSchema.parse(input.settings ?? {}),
    createdAt: now,
    updatedAt: now
  };
}

export function mergeSearch(
  existing: Search,
  input: SearchUpdateInput,
  now: string
): Search {
  return {
    ...existing,
    clientName: input.clientName ?? existing.clientName,
    status: input.status ?? existing.status,
    settings: settingsSchema.parse({ ...existing.settings, ...input.settings }),
    updatedAt: now
  };
}

export function buildMember(input: {
  searchId: string;
  userId: string;
  email: string;
  displayName: string;
  role: MemberRole;
  now: string;
}): Member {
  return {
    userId: input.userId,
    searchId: input.searchId,
    email: input.email,
    displayName: input.displayName,
    role: input.role,
    invitedAt: input.now,
    lastSeenAt: null
  };
}

export function itemToSearch(item: Record<string, unknown>): Search {
  return searchSchema.parse(item);
}

export function itemToMember(item: Record<string, unknown>): Member {
  return memberSchema.parse({ lastSeenAt: null, ...item });
}

/* ---------- searches ---------- */

export async function createSearch(input: SearchCreateInput): Promise<Search> {
  const search = buildSearch(input, newId(), nowIso());
  await ddb().send(
    new PutCommand({
      TableName: T(),
      Item: {
        ...searchKeys.search(search.id),
        ...searchKeys.searchListGsi(search.id),
        ...search
      },
      ConditionExpression: "attribute_not_exists(PK)"
    })
  );
  return search;
}

export async function getSearch(id: string): Promise<Search | null> {
  const res = await ddb().send(
    new GetCommand({ TableName: T(), Key: searchKeys.search(id) })
  );
  return res.Item ? itemToSearch(res.Item) : null;
}

export async function requireSearch(id: string): Promise<Search> {
  const s = await getSearch(id);
  if (!s) throw ApiError.notFound("Search");
  return s;
}

export async function listSearches(
  limit: number,
  cursor?: string
): Promise<Page<Search>> {
  const res = await ddb().send(
    new QueryCommand({
      TableName: T(),
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :p",
      ExpressionAttributeValues: { ":p": "SEARCH" },
      ScanIndexForward: false,
      Limit: limit,
      ExclusiveStartKey: decodeCursor(cursor)
    })
  );
  return {
    items: (res.Items ?? []).map(itemToSearch),
    nextCursor: encodeCursor(res.LastEvaluatedKey)
  };
}

export async function updateSearch(
  id: string,
  input: SearchUpdateInput
): Promise<Search> {
  const existing = await requireSearch(id);
  const merged = mergeSearch(existing, input, nowIso());
  await ddb().send(
    new PutCommand({
      TableName: T(),
      Item: {
        ...searchKeys.search(id),
        ...searchKeys.searchListGsi(id),
        ...merged
      }
    })
  );
  return merged;
}

/** Deletes every item in the search partition (META, BRIEF, MEMBER#…). */
export async function deleteSearch(id: string): Promise<void> {
  const res = await ddb().send(
    new QueryCommand({
      TableName: T(),
      KeyConditionExpression: "PK = :p",
      ExpressionAttributeValues: { ":p": `SEARCH#${id}` },
      ProjectionExpression: "PK, SK"
    })
  );
  const keys = (res.Items ?? []) as { PK: string; SK: string }[];
  for (let i = 0; i < keys.length; i += 25) {
    await ddb().send(
      new BatchWriteCommand({
        RequestItems: {
          [T()]: keys
            .slice(i, i + 25)
            .map((Key) => ({ DeleteRequest: { Key } }))
        }
      })
    );
  }
}

/* ---------- brief ---------- */

export async function getBrief(searchId: string): Promise<Brief> {
  const res = await ddb().send(
    new GetCommand({ TableName: T(), Key: searchKeys.brief(searchId) })
  );
  return briefSchema.parse(res.Item ?? {});
}

export async function putBrief(searchId: string, brief: Brief): Promise<void> {
  await ddb().send(
    new PutCommand({
      TableName: T(),
      Item: { ...searchKeys.brief(searchId), ...brief }
    })
  );
}

/* ---------- members ---------- */

export async function putMember(member: Member): Promise<void> {
  const item: Record<string, unknown> = {
    ...searchKeys.member(member.searchId, member.userId),
    ...searchKeys.memberGsi(member.userId, member.searchId),
    ...member
  };
  // lastSeenAt is omitted until first seen so the touch condition stays simple.
  if (member.lastSeenAt === null) delete item.lastSeenAt;
  await ddb().send(new PutCommand({ TableName: T(), Item: item }));
}

export async function removeMember(
  searchId: string,
  userId: string
): Promise<void> {
  await ddb().send(
    new DeleteCommand({ TableName: T(), Key: searchKeys.member(searchId, userId) })
  );
}

export async function listMembers(searchId: string): Promise<Member[]> {
  const res = await ddb().send(
    new QueryCommand({
      TableName: T(),
      KeyConditionExpression: "PK = :p AND begins_with(SK, :s)",
      ExpressionAttributeValues: {
        ":p": `SEARCH#${searchId}`,
        ":s": "MEMBER#"
      }
    })
  );
  return (res.Items ?? []).map(itemToMember);
}

/**
 * Refresh the member's lastSeenAt, at most every 15 minutes.
 * Returns true when it actually updated (used to emit one "opened the
 * search" activity event per visit instead of one per request).
 */
export async function touchLastSeen(
  searchId: string,
  userId: string
): Promise<boolean> {
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  try {
    await ddb().send(
      new UpdateCommand({
        TableName: T(),
        Key: searchKeys.member(searchId, userId),
        UpdateExpression: "SET lastSeenAt = :now",
        ConditionExpression:
          "attribute_exists(PK) AND (attribute_not_exists(lastSeenAt) OR lastSeenAt < :cutoff)",
        ExpressionAttributeValues: { ":now": nowIso(), ":cutoff": cutoff }
      })
    );
    return true;
  } catch (err) {
    if ((err as { name?: string }).name === "ConditionalCheckFailedException") {
      return false;
    }
    throw err;
  }
}
