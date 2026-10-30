import type { ImportJob, ImportStage } from "@jj/shared";

/** Where an import is right now, from the admin's point of view. */
export type ImportProgress =
  | { kind: "queued" }
  | { kind: ImportStage }
  /** Pasted text: no fetch, straight to reading. */
  | { kind: "reading" }
  | { kind: "photos"; current: number; total: number };

/** After this long the hint stops promising "a few seconds". */
export const SLOW_AFTER_MS = 40_000;

/** The job's own status/stage, as progress. */
export function progressOfJob(job: ImportJob): ImportProgress {
  if (job.status === "queued") return { kind: "queued" };
  return { kind: job.stage ?? "fetching" };
}

/** The "house being built" copy for the import modal: a headline per step
 *  and a quieter line saying what is actually happening. */
export function progressCopy(
  p: ImportProgress,
  elapsedMs: number
): { label: string; hint: string } {
  const slow = elapsedMs >= SLOW_AFTER_MS;
  const patience = slow
    ? "Still building — some portals and the AI take their time. This can run up to about two minutes."
    : "Usually 10–30 seconds.";
  switch (p.kind) {
    case "queued":
      return { label: "Clearing the plot", hint: `Waiting for a builder to pick the job up. ${patience}` };
    case "fetching":
      return { label: "Laying the foundation", hint: `Fetching the listing page from the portal. ${patience}` };
    case "extracting":
      return { label: "Raising the walls", hint: `Reading the details off the page. ${patience}` };
    case "reading":
      return { label: "Raising the walls", hint: `Reading the pasted text. ${patience}` };
    case "saving":
      return { label: "Putting on the roof", hint: "Creating the draft listing." };
    case "photos":
      return {
        label: "Hanging the pictures",
        hint: `Importing photos ${p.current} / ${p.total}.`
      };
  }
}
