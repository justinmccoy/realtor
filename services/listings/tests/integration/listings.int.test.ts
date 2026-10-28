/**
 * Integration tests: in-process dynalite by default, or DynamoDB Local when
 * DDB_ENDPOINT is set (CI / docker compose).
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
import { listingCreateSchema } from "@jj/shared";

const run = process.env.RUN_INTEGRATION === "1";
const TABLE = "jj-listing-int-test";
const SID = "01JD4WPKXK8Z1Q2W3E4R5T6Y7V";

process.env.LISTING_TABLE = TABLE;
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

const input = (over: Record<string, unknown>) =>
  listingCreateSchema.parse({ bezirk: "Mitte", ...over });

describe.skipIf(!run)("listing repo against DynamoDB (local emulator)", () => {
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

  it("CRUD round-trip with full artifact field set", async () => {
    const repo = await import("../../src/repo.js");
    const created = await repo.createListing(
      SID,
      input({
        title: "Bright Altbau with balcony",
        bezirk: "Friedrichshain-Kreuzberg",
        ortsteil: "Kreuzberg",
        kiez: "Bergmannkiez, Zossener Str.",
        price: 489000,
        sqm: 78,
        rooms: 3,
        beds: 2,
        baths: 1,
        floor: "3rd floor",
        year: "1905",
        hausgeld: 340,
        balcony: "yes",
        balconyNote: "South-west, approx. 6 m²",
        pros: ["Stucco", "Balcony"],
        cons: ["Old kitchen"],
        remodel: { none: false, items: ["Kitchen"], cost: 25000, comment: "" }
      })
    );
    const read = await repo.getListing(SID, created.id);
    expect(read).toEqual(created);

    const { after } = await repo.updateListing(SID, created.id, {
      status: "short",
      published: true
    });
    expect(after.status).toBe("short");
    expect(after.pros).toEqual(["Stucco", "Balcony"]);

    const deleted = await repo.deleteListing(SID, created.id);
    expect(deleted.id).toBe(created.id);
    expect(await repo.getListing(SID, created.id)).toBeNull();
  });

  it("benchmark and top-5 ranks stay exclusive", async () => {
    const repo = await import("../../src/repo.js");
    const a = await repo.createListing(
      SID,
      input({ title: "A", benchmark: true, topRank: 1 })
    );
    const b = await repo.createListing(
      SID,
      input({ title: "B", benchmark: true, topRank: 1 })
    );
    const all = await repo.listAll(SID);
    const fa = all.find((l) => l.id === a.id)!;
    const fb = all.find((l) => l.id === b.id)!;
    expect(fb.benchmark).toBe(true);
    expect(fb.topRank).toBe(1);
    expect(fa.benchmark).toBe(false);
    expect(fa.topRank).toBe(0);

    // Moving B to rank 2 leaves rank 1 empty rather than reshuffling.
    await repo.updateListing(SID, b.id, { topRank: 2 });
    const again = await repo.listAll(SID);
    expect(again.filter((l) => l.topRank === 1)).toHaveLength(0);
  });

  it("sparse viewings index tracks set and cleared viewing dates", async () => {
    const repo = await import("../../src/repo.js");
    const inTwoDays = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const l = await repo.createListing(
      SID,
      input({ title: "Viewing soon", viewingAt: inTwoDays })
    );

    const upcoming = await repo.upcomingViewings(14);
    expect(upcoming.some((x) => x.id === l.id)).toBe(true);

    await repo.updateListing(SID, l.id, { viewingAt: null });
    const after = await repo.upcomingViewings(14);
    expect(after.some((x) => x.id === l.id)).toBe(false);
  });

  it("inbox: dedupes urls, links and unlinks listings", async () => {
    const repo = await import("../../src/repo.js");
    const urls = [
      "https://www.immobilienscout24.de/expose/int-1",
      "https://www.immobilienscout24.de/expose/int-2"
    ];
    const created = await repo.addSources(SID, urls);
    expect(created).toHaveLength(2);
    const again = await repo.addSources(SID, [
      urls[0]!,
      "https://www.immobilienscout24.de/expose/int-3"
    ]);
    expect(again).toHaveLength(1);

    const listing = await repo.createListing(SID, input({ title: "From inbox" }));
    const src = created[0]!;
    const linked = await repo.updateSource(SID, src.id, {
      status: "done",
      listingId: listing.id
    });
    expect(linked.status).toBe("done");

    // Deleting the listing resets the linked source to pending.
    await repo.deleteListing(SID, listing.id);
    const sources = await repo.listSources(SID);
    const reset = sources.find((s) => s.id === src.id)!;
    expect(reset.listingId).toBeNull();
    expect(reset.status).toBe("pending");

    await repo.deleteSource(SID, src.id);
    expect((await repo.listSources(SID)).some((s) => s.id === src.id)).toBe(false);
  });
});
