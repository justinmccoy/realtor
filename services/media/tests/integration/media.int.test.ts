/**
 * Metadata-layer integration tests (dynalite by default, DynamoDB Local via
 * DDB_ENDPOINT). S3 interactions are covered by the handler flow in dev —
 * presigning itself is a local signing operation with no network call.
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
import { newId } from "@jj/lambda-kit";
import type { Photo } from "@jj/shared";
import { photoS3Key } from "../../src/keys.js";

const run = process.env.RUN_INTEGRATION === "1";
const TABLE = "jj-media-int-test";

process.env.MEDIA_TABLE = TABLE;
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

function photo(listingId: string, over: Partial<Photo> = {}): Photo {
  const id = over.id ?? newId();
  return {
    id,
    listingId,
    kind: "photo",
    s3Key: photoS3Key(listingId, id, "image/jpeg"),
    contentType: "image/jpeg",
    sortOrder: 0,
    status: "pending",
    createdAt: new Date().toISOString(),
    ...over
  };
}

describe.skipIf(!run)("media repo against DynamoDB (local emulator)", () => {
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

  it("pending → ready lifecycle with per-listing sort orders", async () => {
    const repo = await import("../../src/repo.js");
    const lid = newId();

    expect(await repo.nextSortOrder(lid)).toBe(0);
    const p1 = photo(lid, { sortOrder: await repo.nextSortOrder(lid) });
    await repo.putPhoto(p1);
    const p2 = photo(lid, { sortOrder: await repo.nextSortOrder(lid) });
    await repo.putPhoto(p2);
    expect(p2.sortOrder).toBe(1);

    const ready = await repo.markReady(lid, p1.id);
    expect(ready.status).toBe("ready");
    expect((await repo.getPhoto(lid, p2.id))?.status).toBe("pending");

    const all = await repo.listByListing(lid);
    expect(all.map((p) => p.id)).toEqual([p1.id, p2.id]);
  });

  it("active-flag map defaults false and follows events", async () => {
    const repo = await import("../../src/repo.js");
    const lidA = newId();
    const lidB = newId();
    await repo.putPhoto(photo(lidA, { status: "ready" }));
    await repo.putPhoto(photo(lidB, { status: "ready" }));

    // No META yet: everything defaults to inactive.
    let map = await repo.publishedMap([lidA, lidB]);
    expect(map[lidA]).toBe(false);
    expect(map[lidB]).toBe(false);

    await repo.setPublished(lidA, true);
    map = await repo.publishedMap([lidA, lidB]);
    expect(map[lidA]).toBe(true);
    expect(map[lidB]).toBe(false);

    await repo.setPublished(lidA, false);
    map = await repo.publishedMap([lidA]);
    expect(map[lidA]).toBe(false);
  });

  it("reorder validates coverage and persists new order", async () => {
    const repo = await import("../../src/repo.js");
    const lid = newId();
    const a = photo(lid, { sortOrder: 0, status: "ready" });
    const b = photo(lid, { sortOrder: 1, status: "ready" });
    const fp = photo(lid, { sortOrder: 2, status: "ready", kind: "floorplan" });
    for (const p of [a, b, fp]) await repo.putPhoto(p);

    // Floor plans are ordered independently of photos.
    const reordered = await repo.reorder(lid, "photo", [b.id, a.id]);
    expect(reordered.map((p) => p.id)).toEqual([b.id, a.id]);
    expect(reordered.map((p) => p.sortOrder)).toEqual([0, 1]);

    await expect(repo.reorder(lid, "photo", [a.id])).rejects.toThrow(
      /exactly the listing's photo ids/
    );
    await expect(repo.reorder(lid, "photo", [a.id, fp.id])).rejects.toThrow();
  });

  it("deleteAllForListing clears items and returns S3 keys", async () => {
    const repo = await import("../../src/repo.js");
    const lid = newId();
    const p1 = photo(lid, { status: "ready" });
    const p2 = photo(lid, { kind: "floorplan", status: "ready" });
    await repo.putPhoto(p1);
    await repo.putPhoto(p2);
    await repo.setPublished(lid, true);

    const keys = await repo.deleteAllForListing(lid);
    expect(new Set(keys)).toEqual(new Set([p1.s3Key, p2.s3Key]));
    expect(await repo.listByListing(lid)).toHaveLength(0);
    expect((await repo.publishedMap([lid]))[lid]).toBe(false);
  });
});
