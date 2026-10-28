/**
 * Integration tests against a real DynamoDB wire protocol.
 * - Default: an in-process dynalite server (no Docker needed).
 * - Set DDB_ENDPOINT (e.g. http://localhost:8000 from docker-compose) to run
 *   against DynamoDB Local instead — CI does this.
 * Run via: pnpm --filter @jj/search-svc test:integration
 */
import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  ResourceNotFoundException
} from "@aws-sdk/client-dynamodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import dynalite from "dynalite";
import type { Server } from "http";

const run = process.env.RUN_INTEGRATION === "1";
const TABLE = "jj-search-int-test";

process.env.SEARCH_TABLE = TABLE;
process.env.AWS_REGION = "eu-central-1";

let dynaliteServer: Server | undefined;
let admin: DynamoDBClient;

async function ensureEndpoint(): Promise<string> {
  if (process.env.DDB_ENDPOINT) return process.env.DDB_ENDPOINT;
  dynaliteServer = dynalite({ createTableMs: 0, deleteTableMs: 0 });
  await new Promise<void>((resolve) => dynaliteServer!.listen(0, resolve));
  const address = dynaliteServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("dynalite did not report a port");
  }
  const endpoint = `http://127.0.0.1:${address.port}`;
  process.env.DDB_ENDPOINT = endpoint;
  return endpoint;
}

describe.skipIf(!run)("search repo against DynamoDB (local emulator)", () => {
  afterAll(() => {
    dynaliteServer?.close();
  });

  beforeAll(async () => {
    const endpoint = await ensureEndpoint();
    admin = new DynamoDBClient({
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
          { AttributeName: "GSI1SK", AttributeType: "S" }
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
          }
        ]
      })
    );
  }, 30_000);

  it("creates, reads, updates, lists and archives a search", async () => {
    const repo = await import("../../src/repo.js");

    const a = await repo.createSearch({ clientName: "Brian" });
    const b = await repo.createSearch({
      clientName: "Dana",
      settings: { rate: 60 }
    });
    const c = await repo.createSearch({ clientName: "Elif" });

    expect((await repo.getSearch(a.id))?.clientName).toBe("Brian");

    const page1 = await repo.listSearches(2);
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBeTypeOf("string");
    const page2 = await repo.listSearches(2, page1.nextCursor!);
    expect(page2.items).toHaveLength(1);
    const allIds = [...page1.items, ...page2.items].map((s) => s.id);
    expect(new Set(allIds)).toEqual(new Set([a.id, b.id, c.id]));
    // newest first (ULIDs sort by creation time)
    expect(allIds[0]).toBe(c.id);

    const archived = await repo.updateSearch(b.id, { status: "archived" });
    expect(archived.status).toBe("archived");
    expect(archived.settings.rate).toBe(60);
  });

  it("brief round-trips and defaults to empty", async () => {
    const repo = await import("../../src/repo.js");
    const s = await repo.createSearch({ clientName: "Brief Test" });

    const empty = await repo.getBrief(s.id);
    expect(empty.budget).toBe(0);
    expect(empty.must).toEqual([]);

    const brief = {
      ...empty,
      budget: 750000,
      minSqm: 70,
      minBeds: 2,
      districts: ["Friedrichshain-Kreuzberg" as const],
      must: ["Balcony"]
    };
    await repo.putBrief(s.id, brief);
    expect(await repo.getBrief(s.id)).toEqual(brief);
  });

  it("members: add, list, membership GSI, lastSeen throttling, remove", async () => {
    const repo = await import("../../src/repo.js");
    const { QueryCommand } = await import("@aws-sdk/lib-dynamodb");
    const { ddb } = await import("@jj/lambda-kit");

    const s = await repo.createSearch({ clientName: "Members Test" });
    const member = repo.buildMember({
      searchId: s.id,
      userId: "sub-abc",
      email: "brian@example.com",
      displayName: "Brian",
      role: "client",
      now: new Date().toISOString()
    });
    await repo.putMember(member);

    const members = await repo.listMembers(s.id);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ userId: "sub-abc", lastSeenAt: null });

    // The customer authorizer's exact query path:
    const gsi = await ddb().send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :u",
        ExpressionAttributeValues: { ":u": "USER#sub-abc" }
      })
    );
    expect(gsi.Items).toHaveLength(1);
    expect(gsi.Items![0]).toMatchObject({ searchId: s.id, role: "client" });

    // First touch updates, immediate second touch is throttled.
    expect(await repo.touchLastSeen(s.id, "sub-abc")).toBe(true);
    expect(await repo.touchLastSeen(s.id, "sub-abc")).toBe(false);
    const seen = await repo.listMembers(s.id);
    expect(seen[0]!.lastSeenAt).not.toBeNull();

    // Touching a non-member reports false rather than creating a record.
    expect(await repo.touchLastSeen(s.id, "sub-stranger")).toBe(false);

    await repo.removeMember(s.id, "sub-abc");
    expect(await repo.listMembers(s.id)).toHaveLength(0);
  });

  it("deleteSearch clears the whole partition", async () => {
    const repo = await import("../../src/repo.js");
    const s = await repo.createSearch({ clientName: "Delete Test" });
    await repo.putBrief(s.id, await repo.getBrief(s.id));
    await repo.putMember(
      repo.buildMember({
        searchId: s.id,
        userId: "sub-x",
        email: "x@example.com",
        displayName: "X",
        role: "viewer",
        now: new Date().toISOString()
      })
    );
    await repo.deleteSearch(s.id);
    expect(await repo.getSearch(s.id)).toBeNull();
    expect(await repo.listMembers(s.id)).toHaveLength(0);
  });
});
