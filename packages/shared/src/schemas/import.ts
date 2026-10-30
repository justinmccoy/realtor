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

export const MAX_IMPORT_CONTENT_CHARS = 2_000_000;

/** Either a link to fetch, or pasted page content when the portal blocks
 *  automated requests. `sourceId` links the result back to an inbox entry. */
export const importRequestSchema = z
  .object({
    url: httpUrl.optional(),
    sourceId: z.string().ulid().optional(),
    content: z.string().min(40).max(MAX_IMPORT_CONTENT_CHARS).optional()
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
