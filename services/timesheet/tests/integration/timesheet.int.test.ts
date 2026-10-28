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
import { ApiError } from "@jj/shared";

const run = process.env.RUN_INTEGRATION === "1";
const TABLE = "jj-timesheet-int-test";
const SID = "01JD4WPKXK8Z1Q2W3E4R5T6Y7V";

process.env.TIMESHEET_TABLE = TABLE;
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

describe.skipIf(!run)("timesheet repo against DynamoDB (local emulator)", () => {
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
          { AttributeName: "SK", AttributeType: "S" }
        ],
        KeySchema: [
          { AttributeName: "PK", KeyType: "HASH" },
          { AttributeName: "SK", KeyType: "RANGE" }
        ]
      })
    );
  }, 30_000);

  it("entry lifecycle: create, update (paid), delete", async () => {
    const repo = await import("../../src/repo.js");
    const entry = await repo.createEntry(SID, {
      date: "2026-10-10",
      minutes: 90,
      category: "Viewing",
      listingId: null,
      note: "Bergmannkiez viewing"
    });
    expect(entry.paid).toBe(false);

    const { after } = await repo.updateEntry(SID, entry.id, { paid: true });
    expect(after.paid).toBe(true);
    expect(after.paidAt).not.toBeNull();

    const deleted = await repo.deleteEntry(SID, entry.id);
    expect(deleted.id).toBe(entry.id);
    await expect(repo.requireEntry(SID, entry.id)).rejects.toThrow(ApiError);
  });

  it("payMonth marks only that month's unpaid entries", async () => {
    const repo = await import("../../src/repo.js");
    const mk = (date: string) =>
      repo.createEntry(SID, {
        date,
        minutes: 60,
        category: "Research",
        listingId: null,
        note: ""
      });
    const sept = await mk("2026-09-25");
    const octA = await mk("2026-10-06");
    const octB = await mk("2026-10-24");
    await repo.updateEntry(SID, octB.id, { paid: true }); // already paid

    const updated = await repo.payMonth(SID, "2026-10");
    expect(updated.map((e) => e.id)).toEqual([octA.id]);

    const all = await repo.listEntries(SID);
    expect(all.find((e) => e.id === sept.id)?.paid).toBe(false);
    expect(all.find((e) => e.id === octA.id)?.paid).toBe(true);

    expect(await repo.payMonth(SID, "2026-10")).toHaveLength(0);
  });

  it("timer: single instance, start/clear", async () => {
    const repo = await import("../../src/repo.js");
    expect(await repo.getTimer(SID)).toBeNull();

    const timer = {
      searchId: SID,
      startedAt: new Date().toISOString(),
      category: "Calls & email" as const,
      note: "Agent follow-ups"
    };
    await repo.startTimer(timer);
    expect((await repo.getTimer(SID))?.note).toBe("Agent follow-ups");

    await expect(repo.startTimer(timer)).rejects.toThrow(/already running/);

    await repo.clearTimer(SID);
    expect(await repo.getTimer(SID)).toBeNull();
  });
});
