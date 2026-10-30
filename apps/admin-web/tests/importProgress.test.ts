import { describe, expect, it } from "vitest";
import type { ImportJob } from "@jj/shared";
import {
  progressCopy,
  progressOfJob,
  SLOW_AFTER_MS
} from "../src/lib/importProgress";

const job = (over: Partial<ImportJob>): ImportJob => ({
  id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  status: "queued",
  stage: null,
  request: { url: "https://www.immobilienscout24.de/expose/1" },
  requestedBy: { userId: "u", email: "a@b.c", displayName: "A" },
  createdAt: "2026-10-30T10:00:00.000Z",
  startedAt: null,
  finishedAt: null,
  result: null,
  error: null,
  expiresAt: 0,
  ...over
});

describe("progressOfJob", () => {
  it("maps queue and stages", () => {
    expect(progressOfJob(job({}))).toEqual({ kind: "queued" });
    expect(progressOfJob(job({ status: "running", stage: null }))).toEqual({ kind: "fetching" });
    expect(progressOfJob(job({ status: "running", stage: "extracting" }))).toEqual({
      kind: "extracting"
    });
  });
});

describe("progressCopy", () => {
  it("builds the house in order", () => {
    const labels = (
      [{ kind: "queued" }, { kind: "fetching" }, { kind: "extracting" }, { kind: "saving" }] as const
    ).map((p) => progressCopy(p, 0).label);
    expect(labels).toEqual([
      "Clearing the plot",
      "Laying the foundation",
      "Raising the walls",
      "Putting on the roof"
    ]);
    expect(progressCopy({ kind: "photos", current: 6, total: 15 , }, 0)).toEqual({
      label: "Hanging the pictures",
      hint: "Importing photos 6 / 15."
    });
  });

  it("changes its tone once the import is slow", () => {
    expect(progressCopy({ kind: "fetching" }, 1_000).hint).toMatch(/Usually 10–30 seconds/);
    expect(progressCopy({ kind: "fetching" }, SLOW_AFTER_MS).hint).toMatch(/two minutes/);
    expect(progressCopy({ kind: "reading" }, SLOW_AFTER_MS).hint).toMatch(/pasted text/);
  });
});
