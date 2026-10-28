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
const OTHER_SID = "01JD4WPKXK8Z1Q2W3E4R5T6Y99";

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

  it("listing meta guards cross-tenant and unpublished writes", async () => {
    const repo = await import("../../src/repo.js");
    const lid = newId();

    // Meta not yet arrived via events → not found.
    await expect(
      repo.requireListingInSearch(lid, SID, { mustBePublished: true })
    ).rejects.toThrow(ApiError);

    await repo.setListingMeta(lid, {
      searchId: SID,
      title: "Bright Altbau",
      published: false
    });
    // Belongs to a different search → not found (no existence leak).
    await expect(
      repo.requireListingInSearch(lid, OTHER_SID, { mustBePublished: false })
    ).rejects.toThrow(/not found/i);
    // Unpublished blocks customers but not admins.
    await expect(
      repo.requireListingInSearch(lid, SID, { mustBePublished: true })
    ).rejects.toThrow(/not available/);
    const meta = await repo.requireListingInSearch(lid, SID, {
      mustBePublished: false
    });
    expect(meta.title).toBe("Bright Altbau");

    await repo.setListingMeta(lid, { ...meta, published: true });
    await expect(
      repo.requireListingInSearch(lid, SID, { mustBePublished: true })
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

  it("comments: ordering, threads, soft delete", async () => {
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

    const redacted = await repo.softDeleteComment(SID, first.id);
    expect(redacted.body).toBe("");
    expect(redacted.deletedAt).not.toBeNull();
    const after = await repo.listComments(SID);
    const kept = after.find((c) => c.id === first.id)!;
    expect(kept.deletedAt).not.toBeNull();
    // Thread structure survives: the reply still points at the parent.
    expect(after.find((c) => c.id === reply.id)?.parentId).toBe(first.id);
  });
});
