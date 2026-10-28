import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand
} from "@aws-sdk/lib-dynamodb";
import { ddb, newId, nowIso, tableName } from "@jj/lambda-kit";
import {
  ApiError,
  hoursEntrySchema,
  timerSchema,
  type HoursCreateInput,
  type HoursEntry,
  type HoursUpdateInput,
  type Timer
} from "@jj/shared";
import { entriesInMonth, mergeEntry } from "./domain.js";

const T = (): string => tableName("TIMESHEET_TABLE");

const keys = {
  entry: (searchId: string, entryId: string) => ({
    PK: `SEARCH#${searchId}`,
    SK: `HOURS#${entryId}`
  }),
  timer: (searchId: string) => ({ PK: `SEARCH#${searchId}`, SK: "TIMER" })
};

export function itemToEntry(item: Record<string, unknown>): HoursEntry {
  return hoursEntrySchema.parse(item);
}

async function putEntry(e: HoursEntry): Promise<void> {
  await ddb().send(
    new PutCommand({ TableName: T(), Item: { ...keys.entry(e.searchId, e.id), ...e } })
  );
}

export async function createEntry(
  searchId: string,
  input: HoursCreateInput
): Promise<HoursEntry> {
  const entry: HoursEntry = {
    id: newId(),
    searchId,
    ...input,
    paid: false,
    paidAt: null,
    createdAt: nowIso()
  };
  await putEntry(entry);
  return entry;
}

export async function getEntry(
  searchId: string,
  entryId: string
): Promise<HoursEntry | null> {
  const res = await ddb().send(
    new GetCommand({ TableName: T(), Key: keys.entry(searchId, entryId) })
  );
  return res.Item ? itemToEntry(res.Item) : null;
}

export async function requireEntry(
  searchId: string,
  entryId: string
): Promise<HoursEntry> {
  const e = await getEntry(searchId, entryId);
  if (!e) throw ApiError.notFound("Hours entry");
  return e;
}

export async function updateEntry(
  searchId: string,
  entryId: string,
  patch: HoursUpdateInput
): Promise<{ before: HoursEntry; after: HoursEntry }> {
  const before = await requireEntry(searchId, entryId);
  const after = mergeEntry(before, patch, nowIso());
  await putEntry(after);
  return { before, after };
}

export async function deleteEntry(
  searchId: string,
  entryId: string
): Promise<HoursEntry> {
  const existing = await requireEntry(searchId, entryId);
  await ddb().send(
    new DeleteCommand({ TableName: T(), Key: keys.entry(searchId, entryId) })
  );
  return existing;
}

export async function listEntries(searchId: string): Promise<HoursEntry[]> {
  const items: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await ddb().send(
      new QueryCommand({
        TableName: T(),
        KeyConditionExpression: "PK = :p AND begins_with(SK, :s)",
        ExpressionAttributeValues: { ":p": `SEARCH#${searchId}`, ":s": "HOURS#" },
        ExclusiveStartKey: lastKey
      })
    );
    items.push(...(res.Items ?? []));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey && items.length < 5000);
  return items.map(itemToEntry);
}

/** Marks every unpaid entry of a YYYY-MM month paid; returns them. */
export async function payMonth(
  searchId: string,
  month: string
): Promise<HoursEntry[]> {
  const now = nowIso();
  const open = entriesInMonth(await listEntries(searchId), month).filter(
    (e) => !e.paid
  );
  const updated: HoursEntry[] = [];
  for (const e of open) {
    const paid: HoursEntry = { ...e, paid: true, paidAt: now };
    await putEntry(paid);
    updated.push(paid);
  }
  return updated;
}

/* ---------- timer (one per search) ---------- */

export async function getTimer(searchId: string): Promise<Timer | null> {
  const res = await ddb().send(
    new GetCommand({ TableName: T(), Key: keys.timer(searchId) })
  );
  return res.Item ? timerSchema.parse(res.Item) : null;
}

export async function startTimer(timer: Timer): Promise<void> {
  try {
    await ddb().send(
      new PutCommand({
        TableName: T(),
        Item: { ...keys.timer(timer.searchId), ...timer },
        ConditionExpression: "attribute_not_exists(PK)"
      })
    );
  } catch (err) {
    if ((err as { name?: string }).name === "ConditionalCheckFailedException") {
      throw ApiError.conflict("A timer is already running — stop or discard it first");
    }
    throw err;
  }
}

export async function clearTimer(searchId: string): Promise<void> {
  await ddb().send(
    new DeleteCommand({ TableName: T(), Key: keys.timer(searchId) })
  );
}
