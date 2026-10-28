/** Integration tests: dynalite by default, DynamoDB Local via DDB_ENDPOINT. */
import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  ResourceNotFoundException
} from "@aws-sdk/client-dynamodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import dynalite from "dynalite";
import type { Server } from "http";
import { newId } from "@jj/lambda-kit";
import type { ActivityRecord } from "@jj/shared";

const run = process.env.RUN_INTEGRATION === "1";
const TABLE = "jj-activity-int-test";
const SID = "01JD4WPKXK8Z1Q2W3E4R5T6Y7V";

process.env.ACTIVITY_TABLE = TABLE;
process.env.AWS_REGION = "eu-central-1";

let server: Server | undefined;

async function ensureEndpoint(): Promise<string> {
  if (process.env.DDB_ENDPOINT) return process.env.DDB_ENDPOINT;
  server = dynalite({ createTableMs: 0, deleteTableMs: 0 });
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("dynalite did not report a port");
  }
  const endpoint = `http://127.0.0.1:${address.port}`;
  process.env.DDB_ENDPOINT = endpoint;
  return endpoint;
}

function record(over: Partial<ActivityRecord>): ActivityRecord {
  return {
    id: newId(),
    searchId: SID,
    listingId: null,
    type: "client.session_start",
    actorId: "user-1",
    actorName: "Brian",
    actorRole: "client",
    summary: "Brian opened the site",
    at: new Date().toISOString(),
    payload: null,
    ...over
  };
}

describe.skipIf(!run)("activity repo against DynamoDB (local emulator)", () => {
  afterAll(() => server?.close());

  beforeAll(async () => {
    const endpoint = await ensureEndpoint();
    const admin = new DynamoDBClient({
      endpoint,
      region: "eu-central-1",
      credentials: { accessKeyId: "local", secretAccessKey: "local" }
    });
    try {
      await admin.send(new DeleteTableCommand({ TableName: TABLE }));
    } catch (e) {
      if (!(e instanceof ResourceNotFoundException)) throw e;
    }
    await admin.send(
      new CreateTableCommand({
        TableName: TABLE,
        BillingMode: "PAY_PER_REQUEST",
        AttributeDefinitions: [
          { AttributeName: "PK", AttributeType: "S" },
          { AttributeName: "SK", AttributeType: "S" },
          { AttributeName: "GSI1PK", AttributeType: "S" },
          { AttributeName: "GSI1SK", AttributeType: "S" },
          { AttributeName: "GSI2PK", AttributeType: "S" },
          { AttributeName: "GSI2SK", AttributeType: "S" }
        ],
        KeySchema: [
          { AttributeName: "PK", KeyType: "HASH" },
          { AttributeName: "SK", KeyType: "RANGE" }
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: "GSI1",
            KeySchema: [
              { AttributeName: "GSI1PK", KeyType: "HASH" },
              { AttributeName: "GSI1SK", KeyType: "RANGE" }
            ],
            Projection: { ProjectionType: "ALL" }
          },
          {
            IndexName: "GSI2",
            KeySchema: [
              { AttributeName: "GSI2PK", KeyType: "HASH" },
              { AttributeName: "GSI2SK", KeyType: "RANGE" }
            ],
            Projection: { ProjectionType: "ALL" }
          }
        ]
      })
    );
  }, 30_000);

  it("feed: search partition, actor index, global index, newest first", async () => {
    const repo = await import("../../src/repo.js");
    const t1 = "2026-10-26T10:00:00.000Z";
    const t2 = "2026-10-27T10:00:00.000Z";
    const t3 = "2026-10-28T10:00:00.000Z";
    await repo.putActivity(record({ at: t1, summary: "one" }));
    await repo.putActivity(record({ at: t2, summary: "two", actorId: "user-2" }));
    await repo.putActivity(record({ at: t3, summary: "three" }));

    const bySearch = await repo.feedBySearch(SID, { limit: 10 });
    expect(bySearch.items.map((r) => r.summary)).toEqual(["three", "two", "one"]);

    const byActor = await repo.feedByActor("user-2", { limit: 10 });
    expect(byActor.items).toHaveLength(1);
    expect(byActor.items[0]!.summary).toBe("two");

    const global = await repo.feedGlobal({ limit: 2 });
    expect(global.items).toHaveLength(2);
    expect(global.nextCursor).toBeTypeOf("string");
    const page2 = await repo.feedGlobal({ limit: 2, cursor: global.nextCursor! });
    expect(page2.items.length).toBeGreaterThanOrEqual(1);

    const ranged = await repo.feedBySearch(SID, {
      limit: 10,
      from: "2026-10-27T00:00:00.000Z",
      to: "2026-10-27T23:59:59.000Z"
    });
    expect(ranged.items.map((r) => r.summary)).toEqual(["two"]);
  });

  it("audit log is permanent, ordered, and caps huge payloads", async () => {
    const repo = await import("../../src/repo.js");
    await repo.putAudit({
      at: "2026-10-28T09:00:00.000Z",
      adminId: "admin-1",
      adminName: "JJ",
      action: "update",
      entity: "listing",
      entityId: "L1",
      searchId: SID,
      summary: "Updated listing",
      before: { huge: "x".repeat(10_000) },
      after: { price: 500000 }
    });
    const page = await repo.auditLog({ limit: 10 });
    const item = page.items[0]!;
    expect(item.adminName).toBe("JJ");
    expect(String(item.before).length).toBeLessThanOrEqual(4096);
    expect(String(item.after)).toContain("500000");
  });

  it("engagement rollups accumulate per listing", async () => {
    const repo = await import("../../src/repo.js");
    const lid = newId();
    const at = new Date().toISOString();
    await repo.bumpRollup(SID, lid, "expands", at);
    await repo.bumpRollup(SID, lid, "expands", at);
    await repo.bumpRollup(SID, lid, "photoViews", at);

    const rollup = await repo.getRollup(SID, lid);
    expect(rollup).toMatchObject({
      listingId: lid,
      expands: 2,
      photoViews: 1,
      exposeClicks: 0,
      mapClicks: 0
    });
    expect(rollup!.lastViewedAt).toBe(at);

    const all = await repo.engagementForSearch(SID);
    expect(all.some((r) => r.listingId === lid)).toBe(true);
  });
});
