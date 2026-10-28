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
import { briefSchema, listingCreateSchema, settingsSchema } from "@jj/shared";

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

  it("CRUD round-trip in the global pool", async () => {
    const repo = await import("../../src/repo.js");
    const created = await repo.createListing(
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
        pros: ["Stucco", "Balcony"],
        remodel: { none: false, items: ["Kitchen"], cost: 25000, comment: "" }
      })
    );
    expect(await repo.getListing(created.id)).toEqual(created);

    const { after } = await repo.updateListing(created.id, {
      status: "short",
      published: true
    });
    expect(after.status).toBe("short");
    expect((await repo.listAll()).some((l) => l.id === created.id)).toBe(true);

    const deleted = await repo.deleteListing(created.id);
    expect(deleted.id).toBe(created.id);
    expect(await repo.getListing(created.id)).toBeNull();
  });

  it("benchmark and top-5 ranks stay exclusive across the pool", async () => {
    const repo = await import("../../src/repo.js");
    const a = await repo.createListing(
      input({ title: "A", benchmark: true, topRank: 1 })
    );
    const b = await repo.createListing(
      input({ title: "B", benchmark: true, topRank: 1 })
    );
    const all = await repo.listAll();
    expect(all.find((l) => l.id === b.id)!.benchmark).toBe(true);
    expect(all.find((l) => l.id === a.id)!.benchmark).toBe(false);
    expect(all.find((l) => l.id === a.id)!.topRank).toBe(0);
  });

  it("sparse viewings index tracks set and cleared viewing dates", async () => {
    const repo = await import("../../src/repo.js");
    const inTwoDays = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const l = await repo.createListing(
      input({ title: "Viewing soon", viewingAt: inTwoDays })
    );
    expect((await repo.upcomingViewings(14)).some((x) => x.id === l.id)).toBe(true);
    await repo.updateListing(l.id, { viewingAt: null });
    expect((await repo.upcomingViewings(14)).some((x) => x.id === l.id)).toBe(false);
  });

  it("visibility: criteria matching + share/hide overrides + draft gate", async () => {
    const repo = await import("../../src/repo.js");

    // Criteria arrive via events: Kreuzberg, ≥70 m², ≥2 beds, 750k all-in.
    await repo.putCriteria(SID, {
      brief: briefSchema.parse({
        budget: 750000,
        minSqm: 70,
        minBeds: 2,
        districts: ["Friedrichshain-Kreuzberg"]
      }),
      settings: settingsSchema.parse({ budget: 750000 }),
      status: "active"
    });

    const match = await repo.createListing(
      input({
        title: "Matches",
        bezirk: "Friedrichshain-Kreuzberg",
        price: 489000,
        sqm: 78,
        beds: 2,
        published: true
      })
    );
    const noMatch = await repo.createListing(
      input({
        title: "Spandau no-match",
        bezirk: "Spandau",
        price: 300000,
        sqm: 80,
        beds: 2,
        published: true
      })
    );
    const draft = await repo.createListing(
      input({
        title: "Draft match",
        bezirk: "Friedrichshain-Kreuzberg",
        price: 489000,
        sqm: 78,
        beds: 2,
        published: false
      })
    );

    let visible = await repo.visibleForSearch(SID);
    const ids = () => visible.map((v) => v.listing.id);
    expect(ids()).toContain(match.id);
    expect(ids()).not.toContain(noMatch.id);
    expect(ids()).not.toContain(draft.id); // drafts never leak

    // Manual share beats no-match.
    await repo.putShare(SID, noMatch.id, "shared");
    visible = await repo.visibleForSearch(SID);
    expect(ids()).toContain(noMatch.id);
    expect(visible.find((v) => v.listing.id === noMatch.id)!.reason).toBe("shared");

    // Manual hide beats a match.
    await repo.putShare(SID, match.id, "hidden");
    visible = await repo.visibleForSearch(SID);
    expect(ids()).not.toContain(match.id);

    // Clearing the override returns to auto-matching.
    await repo.clearShare(SID, match.id);
    visible = await repo.visibleForSearch(SID);
    expect(visible.find((v) => v.listing.id === match.id)!.reason).toBe("match");

    // A search with no criteria sees manual shares only.
    const emptySid = "01JD4WPKXK8Z1Q2W3E4R5T6Y98";
    expect(await repo.visibleForSearch(emptySid)).toHaveLength(0);
    await repo.putShare(emptySid, match.id, "shared");
    const onlyShared = await repo.visibleForSearch(emptySid);
    expect(onlyShared.map((v) => v.listing.id)).toEqual([match.id]);
  });

  it("inbox: global, dedupes urls, unlinks on listing delete", async () => {
    const repo = await import("../../src/repo.js");
    const urls = [
      "https://www.immobilienscout24.de/expose/int-1",
      "https://www.immobilienscout24.de/expose/int-2"
    ];
    const created = await repo.addSources(urls);
    expect(created).toHaveLength(2);
    expect(
      await repo.addSources([urls[0]!, "https://www.immobilienscout24.de/expose/int-3"])
    ).toHaveLength(1);

    const listing = await repo.createListing(input({ title: "From inbox" }));
    const src = created[0]!;
    const linked = await repo.updateSource(src.id, {
      status: "done",
      listingId: listing.id
    });
    expect(linked.status).toBe("done");

    await repo.deleteListing(listing.id);
    const reset = (await repo.listSources()).find((s) => s.id === src.id)!;
    expect(reset.listingId).toBeNull();
    expect(reset.status).toBe("pending");

    await repo.deleteSource(src.id);
    expect((await repo.listSources()).some((s) => s.id === src.id)).toBe(false);
  });
});
