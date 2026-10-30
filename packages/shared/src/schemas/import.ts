import { z } from "zod";
import { httpUrl, listingCreateSchema, listingSchema } from "./listing.js";

/** How the page content reached the importer. */
export const IMPORT_FETCH_MODES = ["direct", "proxy", "paste"] as const;
export type ImportFetchMode = (typeof IMPORT_FETCH_MODES)[number];

/** Where an auto-filled value came from: parsed from the page markup, or
 *  extracted by the AI model from the page text. */
export const FIELD_PROVENANCE = ["page", "ai"] as const;
export type FieldProvenance = (typeof FIELD_PROVENANCE)[number];

/** Listing fields the importer is allowed to fill. Everything else (status,
 *  JJ's commentary, viewing data, remodel) stays empty for the admin. */
export const EXTRACTABLE_FIELDS = [
  "title",
  "url",
  "bezirk",
  "ortsteil",
  "kiez",
  "price",
  "sqm",
  "rooms",
  "beds",
  "baths",
  "floor",
  "year",
  "hausgeld",
  "provision",
  "balcony",
  "balconyNote",
  "notes"
] as const;
export type ExtractableField = (typeof EXTRACTABLE_FIELDS)[number];

export const extractedListingSchema = listingCreateSchema
  .pick({
    title: true,
    url: true,
    bezirk: true,
    ortsteil: true,
    kiez: true,
    price: true,
    sqm: true,
    rooms: true,
    beds: true,
    baths: true,
    floor: true,
    year: true,
    hausgeld: true,
    provision: true,
    balcony: true,
    balconyNote: true,
    notes: true
  })
  .partial();
export type ExtractedListing = z.infer<typeof extractedListingSchema>;

/** Portal pages run to 1–3 MB of HTML when pasted whole. */
export const MAX_IMPORT_CONTENT_CHARS = 4_000_000;

/**
 * Either a link to fetch (queued as a background job, see the job schemas
 * below) or page content to read inline: text the admin pasted, or HTML a
 * caller fetched itself, in which case `fetchedVia` says how. `sourceId`
 * links the result back to an inbox entry.
 */
export const importRequestSchema = z
  .object({
    url: httpUrl.optional(),
    sourceId: z.string().ulid().optional(),
    content: z.string().min(40).max(MAX_IMPORT_CONTENT_CHARS).optional(),
    fetchedVia: z.enum(["direct", "proxy"]).optional()
  })
  .refine((r) => r.url !== undefined || r.content !== undefined, {
    message: "Provide a url or pasted content"
  });
export type ImportRequest = z.infer<typeof importRequestSchema>;

export const MAX_IMPORT_PHOTO_URLS = 30;

export const importResultSchema = z.object({
  /** The draft listing that was created (published = false). */
  listing: listingSchema,
  /** Field → where its value came from. Fields not listed were left empty. */
  provenance: z.record(z.enum(FIELD_PROVENANCE)),
  /** Candidate photo URLs found on the page, best first. */
  photoUrls: z.array(httpUrl).max(MAX_IMPORT_PHOTO_URLS),
  warnings: z.array(z.string()),
  fetchedVia: z.enum(IMPORT_FETCH_MODES),
  /** Host the page came from, e.g. "www.immobilienscout24.de". */
  portal: z.string().nullable(),
  aiUsed: z.boolean()
});
export type ImportResult = z.infer<typeof importResultSchema>;

/* ---------- import jobs ---------- */

/** A link import runs as a background job: POST starts it, GET polls it.
 *  Pasted text is read inline (it only needs the AI call) and comes back as
 *  a job that is already `done`. */
export const IMPORT_JOB_STATUSES = ["queued", "running", "done", "failed"] as const;
export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

/** Coarse progress the worker reports while a job runs, in order. */
export const IMPORT_STAGES = ["fetching", "extracting", "saving"] as const;
export type ImportStage = (typeof IMPORT_STAGES)[number];

export const importJobErrorSchema = z.object({
  /** Same codes as the API error envelope, e.g. "upstream_blocked", "timeout". */
  code: z.string(),
  message: z.string()
});
export type ImportJobError = z.infer<typeof importJobErrorSchema>;

export const importJobSchema = z.object({
  id: z.string().ulid(),
  status: z.enum(IMPORT_JOB_STATUSES),
  stage: z.enum(IMPORT_STAGES).nullable(),
  /** What was asked for. Pasted content is never echoed back by the API. */
  request: z.object({
    url: httpUrl.optional(),
    sourceId: z.string().ulid().optional(),
    content: z.string().optional()
  }),
  requestedBy: z.object({
    userId: z.string(),
    email: z.string(),
    displayName: z.string()
  }),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  result: importResultSchema.nullable(),
  error: importJobErrorSchema.nullable(),
  /** DynamoDB TTL (epoch seconds); finished jobs are kept for a day. */
  expiresAt: z.number().int()
});
export type ImportJob = z.infer<typeof importJobSchema>;

/** How long the admin app keeps polling before it gives up on a job. The
 *  worker Lambda has 300 s; the rest is queueing slack. */
export const IMPORT_JOB_WAIT_MS = 330_000;
