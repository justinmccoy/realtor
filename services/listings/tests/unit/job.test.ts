import { describe, expect, it } from "vitest";
import { ApiError, type ImportJob, type ImportResult } from "@jj/shared";
import { runImportJob, type ImportJobPatch, type ImportJobStore } from "../../src/import/job.js";

const JOB_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function queued(): ImportJob {
  return {
    id: JOB_ID,
    status: "queued",
    stage: null,
    request: { url: "https://www.immobilienscout24.de/expose/123456" },
    requestedBy: { userId: "admin-1", email: "a@example.com", displayName: "Admin" },
    createdAt: "2026-10-30T10:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    result: null,
    error: null,
    expiresAt: 1_900_000_000
  };
}

/** In-memory store that applies patches like the DynamoDB UpdateCommand does. */
function memoryStore(initial: ImportJob | null) {
  let job = initial;
  const patches: ImportJobPatch[] = [];
  const store: ImportJobStore = {
    get: async () => job,
    update: async (_id, patch) => {
      patches.push(patch);
      if (job) job = { ...job, ...patch };
    }
  };
  return { store, patches, current: () => job };
}

const result = {
  listing: { id: "L1" },
  provenance: { price: "page" },
  photoUrls: [],
  warnings: [],
  fetchedVia: "direct",
  portal: "immobilienscout24.de",
  aiUsed: false
} as unknown as ImportResult;

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("runImportJob", () => {
  it("runs a queued job to done, recording each stage in order", async () => {
    const m = memoryStore(queued());
    const final = await runImportJob(
      JOB_ID,
      m.store,
      async (job, onStage) => {
        expect(job.status).toBe("running");
        onStage("extracting");
        await tick();
        onStage("saving");
        return result;
      },
      { deadlineMs: 5_000 }
    );
    expect(final?.status).toBe("done");
    expect(final?.result).toBe(result);
    expect(m.current()?.status).toBe("done");
    expect(m.current()?.stage).toBe("saving");
    expect(m.current()?.finishedAt).toBeTruthy();
    expect(m.patches.map((p) => p.status ?? p.stage)).toEqual([
      "running",
      "extracting",
      "saving",
      "done"
    ]);
  });

  it("records an ApiError with its code so the admin app can offer the paste fallback", async () => {
    const m = memoryStore(queued());
    const final = await runImportJob(
      JOB_ID,
      m.store,
      async () => {
        throw new ApiError(422, "upstream_blocked", "portal refused");
      },
      { deadlineMs: 5_000 }
    );
    expect(final?.status).toBe("failed");
    expect(final?.error).toEqual({ code: "upstream_blocked", message: "portal refused" });
    expect(m.current()?.result).toBeNull();
  });

  it("fails the job itself when the deadline passes", async () => {
    const m = memoryStore(queued());
    const final = await runImportJob(
      JOB_ID,
      m.store,
      () => new Promise<ImportResult>(() => {}),
      { deadlineMs: 20 }
    );
    expect(final?.status).toBe("failed");
    expect(final?.error?.code).toBe("timeout");
  });

  it("wraps unknown errors as internal", async () => {
    const m = memoryStore(queued());
    const final = await runImportJob(
      JOB_ID,
      m.store,
      async () => {
        throw new Error("boom");
      },
      { deadlineMs: 5_000 }
    );
    expect(final?.error).toEqual({ code: "internal", message: "boom" });
  });

  it("leaves jobs that are not queued alone (redelivery) and ignores unknown ids", async () => {
    const done = { ...queued(), status: "done" as const };
    const m = memoryStore(done);
    let ran = false;
    const final = await runImportJob(
      JOB_ID,
      m.store,
      async () => {
        ran = true;
        return result;
      },
      { deadlineMs: 5_000 }
    );
    expect(ran).toBe(false);
    expect(final).toBe(done);
    expect(m.patches).toEqual([]);

    const none = memoryStore(null);
    expect(await runImportJob(JOB_ID, none.store, async () => result, { deadlineMs: 5 })).toBeNull();
  });

  it("does not let a failed progress write fail the job", async () => {
    const m = memoryStore(queued());
    let calls = 0;
    const flaky: ImportJobStore = {
      get: m.store.get,
      update: async (id, patch) => {
        if (patch.stage === "extracting" && patch.status === undefined && ++calls === 1) {
          throw new Error("dynamo hiccup");
        }
        await m.store.update(id, patch);
      }
    };
    const final = await runImportJob(
      JOB_ID,
      flaky,
      async (_job, onStage) => {
        onStage("extracting");
        return result;
      },
      { deadlineMs: 5_000 }
    );
    expect(final?.status).toBe("done");
    expect(m.current()?.status).toBe("done");
  });
});
