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
import { ApiError, type Comment, type Rating } from "@jj/shared";

const run = process.env.RUN_INTEGRATION === "1";
const TABLE = "jj-engagement-int-test";
const SID = "01JD4WPKXK8Z1Q2W3E4R5T6Y7V";

process.env.ENGAGEMENT_TABLE = TABLE;
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

function rating(listingId: string, userId: string, score = 4): Rating {
  return {
    listingId,
    searchId: SID,
    userId,
    authorName: "Brian",
    score,
    comment: "Loved the balcony",
    updatedAt: new Date().toISOString()
  };
}

describe.skipIf(!run)("engagement repo against DynamoDB (local emulator)", () => {
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

  it("listing meta guards unknown and draft listings", async () => {
    const repo = await import("../../src/repo.js");
    const lid = newId();

    // Meta not yet arrived via events → not found.
    await expect(
      repo.requireListingActive(lid, { mustBePublished: true })
    ).rejects.toThrow(ApiError);

    await repo.setListingMeta(lid, {
      title: "Bright Altbau",
      published: false
    });
    // Drafts block customers but not admins.
    await expect(
      repo.requireListingActive(lid, { mustBePublished: true })
    ).rejects.toThrow(/not available/);
    const meta = await repo.requireListingActive(lid, {
      mustBePublished: false
    });
    expect(meta.title).toBe("Bright Altbau");

    await repo.setListingMeta(lid, { ...meta, published: true });
    await expect(
      repo.requireListingActive(lid, { mustBePublished: true })
    ).resolves.toBeDefined();
  });

  it("ratings: upsert per user, search-wide GSI, listing cleanup", async () => {
    const repo = await import("../../src/repo.js");
    const lid = newId();

    await repo.putRating(rating(lid, "user-1", 4));
    await repo.putRating(rating(lid, "user-2", 5));
    await repo.putRating({ ...rating(lid, "user-1", 2), comment: "changed my mind" });

    const byListing = await repo.listRatingsByListing(lid);
    expect(byListing).toHaveLength(2);
    expect(byListing.find((r) => r.userId === "user-1")?.score).toBe(2);

    const bySearch = await repo.listRatingsBySearch(SID);
    expect(bySearch.filter((r) => r.listingId === lid)).toHaveLength(2);

    await repo.deleteRatingsForListing(lid);
    expect(await repo.listRatingsByListing(lid)).toHaveLength(0);
  });

  it("comments: ordering, threads, delete removes a root with its replies", async () => {
    const repo = await import("../../src/repo.js");
    const base: Omit<Comment, "id" | "createdAt"> = {
      searchId: SID,
      listingId: null,
      parentId: null,
      authorId: "user-1",
      authorName: "Brian",
      authorRole: "client",
      body: "",
      deletedAt: null
    };
    const first: Comment = {
      ...base,
      id: newId(),
      body: "First comment",
      createdAt: new Date().toISOString()
    };
    await repo.putComment(first);
    // ULIDs minted in the same millisecond sort arbitrarily; make "newer" real.
    await new Promise((r) => setTimeout(r, 5));
    const reply: Comment = {
      ...base,
      id: newId(),
      parentId: first.id,
      body: "A reply",
      createdAt: new Date().toISOString()
    };
    await repo.putComment(reply);

    const list = await repo.listComments(SID);
    expect(list.length).toBeGreaterThanOrEqual(2);
    // Newest first (ULID sort keys descend).
    expect(list.findIndex((c) => c.id === reply.id)).toBeLessThan(
      list.findIndex((c) => c.id === first.id)
    );

    // A second root with a reply, where only the reply is removed.
    const second: Comment = {
      ...base,
      id: newId(),
      body: "Second comment",
      createdAt: new Date().toISOString()
    };
    await repo.putComment(second);
    const secondReply: Comment = {
      ...base,
      id: newId(),
      parentId: second.id,
      body: "Reply to second",
      createdAt: new Date().toISOString()
    };
    await repo.putComment(secondReply);

    const out = await repo.deleteComment(SID, first.id);
    expect(out.removed.id).toBe(first.id);
    expect(out.replies.map((c) => c.id)).toEqual([reply.id]);
    const after = await repo.listComments(SID);
    expect(after.some((c) => c.id === first.id)).toBe(false);
    expect(after.some((c) => c.id === reply.id)).toBe(false);
    expect(after.some((c) => c.id === second.id)).toBe(true);

    const onlyReply = await repo.deleteComment(SID, secondReply.id);
    expect(onlyReply.replies).toEqual([]);
    const afterReply = await repo.listComments(SID);
    expect(afterReply.some((c) => c.id === second.id)).toBe(true);
    expect(afterReply.some((c) => c.id === secondReply.id)).toBe(false);

    await expect(repo.deleteComment(SID, first.id)).rejects.toThrow();

    // Rows soft-deleted by the previous version stay hidden.
    const legacy: Comment = {
      ...base,
      id: newId(),
      body: "",
      deletedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };
    await repo.putComment(legacy);
    expect((await repo.listComments(SID)).some((c) => c.id === legacy.id)).toBe(false);
  });
});
