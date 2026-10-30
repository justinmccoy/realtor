import type { Context, EventBridgeHandler } from "aws-lambda";
import {
  adminAuth,
  apiHandler,
  dispatch,
  logger,
  nowIso,
  publishAdminAction,
  publishEvents,
  type AdminAuth
} from "@jj/lambda-kit";
import {
  ApiError,
  EVENT_SOURCES,
  importRequestSchema,
  listingCreateSchema,
  type DomainEvent,
  type FieldProvenance,
  type ImportJob,
  type ImportResult
} from "@jj/shared";
import { z } from "zod";
import { defaultDeps, runImport, type ImportDeps } from "../import/index.js";
import { runImportJob } from "../import/job.js";
import * as repo from "../repo.js";

/**
 * Link → draft listing, in two Lambdas sharing this file:
 *
 *  - `handler` (API, 29 s): POST queues a link import as a job and answers
 *    at once; the admin app polls GET /import/{jobId}. Pasted text skips the
 *    queue — it only needs the AI call, and at up to 2 MB it would not fit in
 *    a DynamoDB item anyway — and comes back as a job that is already done.
 *  - `worker` (120 s): picks the job up from the event bus. Fetching through
 *    a proxy plus the AI call can take well over API Gateway's 30 s window,
 *    which is the whole reason for the split.
 *
 * Photos are imported afterwards by the media service, batch by batch, from
 * the URLs in the result.
 */

/** Leave the worker time to record a timeout before Lambda kills it. */
const WORKER_GRACE_MS = 5_000;

const jobPath = z.object({ jobId: z.string().ulid() });

/** Everything the admin app needs; pasted content is never sent back. */
function publicJob(job: ImportJob): ImportJob {
  const { content: _content, ...request } = job.request;
  return { ...job, request };
}

/** The import itself, independent of how it was triggered. */
async function importInto(
  request: ImportJob["request"] & { fetchedVia?: "direct" | "proxy" },
  admin: AdminAuth,
  deps: ImportDeps
): Promise<ImportResult> {
  const source = request.sourceId ? await repo.getSource(request.sourceId) : null;
  if (request.sourceId && !source) throw ApiError.notFound("Inbox link");
  const url = request.url ?? source?.url;

  let outcome;
  try {
    outcome = await runImport(
      { url, content: request.content, fetchedVia: request.fetchedVia },
      deps
    );
  } catch (err) {
    if (source && err instanceof ApiError && err.code === "upstream_blocked") {
      await repo.updateSource(source.id, { status: "failed" });
    }
    throw err;
  }

  deps.onStage?.("saving");
  const input = listingCreateSchema.parse({
    ...outcome.fields,
    url: outcome.fields.url ?? url ?? null,
    published: false
  });
  const listing = await repo.createListing(input);
  if (source) {
    await repo.updateSource(source.id, { status: "done", listingId: listing.id });
  }

  const from = outcome.portal ? ` from ${outcome.portal}` : " from pasted text";
  await publishAdminAction(EVENT_SOURCES.listing, admin, {
    action: "import",
    entity: "listing",
    entityId: listing.id,
    listingId: listing.id,
    summary: `Imported "${listing.title}"${from} as a draft`,
    after: listing
  });
  await publishEvents(EVENT_SOURCES.listing, {
    type: "listing.created",
    listingId: listing.id,
    actorId: admin.userId,
    actorName: admin.displayName,
    actorRole: "admin",
    at: nowIso(),
    summary: `Listing "${listing.title}" imported as a draft`,
    payload: { title: listing.title, published: listing.published }
  });

  return {
    listing,
    provenance: outcome.provenance as Record<string, FieldProvenance>,
    photoUrls: outcome.photoUrls,
    warnings: outcome.warnings,
    fetchedVia: outcome.fetchedVia,
    portal: outcome.portal,
    aiUsed: outcome.aiUsed
  };
}

export const handler = dispatch({
  "POST /api/v1/admin/import": apiHandler({
    body: importRequestSchema,
    fn: async ({ body, event, requestId }) => {
      const admin = adminAuth(event);
      const requestedBy = {
        userId: admin.userId,
        email: admin.email,
        displayName: admin.displayName
      };

      if (body.content !== undefined) {
        const result = await importInto(body, admin, defaultDeps("paste"));
        const at = nowIso();
        // Not persisted: a paste import never needs polling. The id is the
        // request id so a log line can still be tied to it.
        const done: ImportJob = {
          id: requestId,
          status: "done",
          stage: "saving",
          request: { url: body.url, sourceId: body.sourceId },
          requestedBy,
          createdAt: at,
          startedAt: at,
          finishedAt: at,
          result,
          error: null,
          expiresAt: Math.floor(Date.now() / 1000)
        };
        return { status: 201, body: done };
      }

      // Fail fast on a stale inbox link rather than from inside the worker.
      if (body.sourceId && !(await repo.getSource(body.sourceId))) {
        throw ApiError.notFound("Inbox link");
      }
      const job = await repo.createImportJob({
        request: { url: body.url, sourceId: body.sourceId },
        requestedBy
      });
      await publishEvents(EVENT_SOURCES.listing, {
        type: "listing.import.requested",
        actorId: admin.userId,
        actorName: admin.displayName,
        actorRole: "admin",
        at: job.createdAt,
        summary: `Import of ${body.url ?? "an inbox link"} queued`,
        payload: { jobId: job.id }
      });
      return { status: 202, body: publicJob(job) };
    }
  }),

  "GET /api/v1/admin/import/{jobId}": apiHandler({
    path: jobPath,
    fn: async ({ path, event }) => {
      adminAuth(event);
      const job = await repo.getImportJob(path.jobId);
      if (!job) throw ApiError.notFound("Import job");
      return { body: publicJob(job) };
    }
  })
});

/** Event-bus consumer for `listing.import.requested`. Never throws for an
 *  import that failed — that is recorded on the job — only for a malformed
 *  event, so EventBridge's retry is reserved for delivery problems. */
export const worker: EventBridgeHandler<"listing.import.requested", DomainEvent, void> = async (
  event,
  context: Context
) => {
  const jobId = (event.detail.payload as { jobId?: unknown } | undefined)?.jobId;
  if (typeof jobId !== "string") {
    throw new Error("listing.import.requested event without a jobId");
  }
  logger.appendKeys({ jobId });
  try {
    await runImportJob(
      jobId,
      { get: repo.getImportJob, update: repo.updateImportJob },
      (job, onStage) => {
        const admin: AdminAuth = { kind: "admin", ...job.requestedBy };
        return importInto(job.request, admin, { ...defaultDeps("link"), onStage });
      },
      { deadlineMs: Math.max(1_000, context.getRemainingTimeInMillis() - WORKER_GRACE_MS) }
    );
  } finally {
    logger.removeKeys(["jobId"]);
  }
};
