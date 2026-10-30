import { logger } from "@jj/lambda-kit";
import { ApiError, type ImportJob, type ImportResult, type ImportStage } from "@jj/shared";

export type ImportJobPatch = Partial<
  Pick<ImportJob, "status" | "stage" | "startedAt" | "finishedAt" | "result" | "error">
>;

/** The slice of the repo the job runner needs; injectable for tests. */
export interface ImportJobStore {
  get: (jobId: string) => Promise<ImportJob | null>;
  update: (jobId: string, patch: ImportJobPatch) => Promise<void>;
}

/** Does the actual import for a job, reporting progress as it goes. */
export type ImportWork = (
  job: ImportJob,
  onStage: (stage: ImportStage) => void
) => Promise<ImportResult>;

export interface RunImportJobOptions {
  /** Wall-clock budget; the job is failed (not killed) when it runs out, so
   *  the admin app sees why. Keep it under the Lambda's own timeout. */
  deadlineMs: number;
  now?: () => string;
}

export class ImportTimeoutError extends ApiError {
  constructor() {
    super(
      504,
      "timeout",
      "The import took too long: the portal or the AI did not answer in time. Try again in a moment, or paste the page text instead."
    );
  }
}

function describe(err: unknown): NonNullable<ImportJob["error"]> {
  if (err instanceof ApiError) return { code: err.code, message: err.message };
  const message = err instanceof Error && err.message ? err.message : "Import failed";
  return { code: "internal", message };
}

/**
 * Drives one queued job to "done" or "failed". Idempotent on redelivery:
 * anything no longer queued is left alone. Progress writes are best-effort
 * and serialised; the final state is written exactly once, after them.
 */
export async function runImportJob(
  jobId: string,
  store: ImportJobStore,
  work: ImportWork,
  opts: RunImportJobOptions
): Promise<ImportJob | null> {
  const now = opts.now ?? (() => new Date().toISOString());
  const job = await store.get(jobId);
  if (!job) {
    logger.warn("import job not found", { jobId });
    return null;
  }
  if (job.status !== "queued") {
    logger.info("import job already picked up", { jobId, status: job.status });
    return job;
  }

  const running: ImportJob = { ...job, status: "running", startedAt: now(), stage: "fetching" };
  await store.update(jobId, { status: "running", startedAt: running.startedAt, stage: "fetching" });

  let stage: ImportStage = "fetching";
  let pending: Promise<void> = Promise.resolve();
  const onStage = (next: ImportStage) => {
    stage = next;
    pending = pending
      .then(() => store.update(jobId, { stage: next }))
      .catch((e: unknown) =>
        logger.warn("import job progress write failed", { jobId, error: String(e) })
      );
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ImportTimeoutError()), opts.deadlineMs);
  });

  let final: ImportJob;
  try {
    const result = await Promise.race([work(running, onStage), timeout]);
    final = { ...running, status: "done", stage, result, error: null, finishedAt: now() };
  } catch (err) {
    const error = describe(err);
    if (error.code === "timeout" || error.code === "internal") {
      logger.error("import job failed", err as Error);
    } else {
      logger.warn("import job failed", { jobId, code: error.code, reason: error.message });
    }
    final = { ...running, status: "failed", stage, result: null, error, finishedAt: now() };
  } finally {
    if (timer) clearTimeout(timer);
  }
  await pending;
  await store.update(jobId, {
    status: final.status,
    stage: final.stage,
    result: final.result,
    error: final.error,
    finishedAt: final.finishedAt
  });
  return final;
}
