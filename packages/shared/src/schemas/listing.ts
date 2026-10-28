import { z } from "zod";
import { DISTRICT_NAMES } from "../berlin.js";
import {
  BALCONY_STATES,
  CONTACT_STATUSES,
  LISTING_STATUSES,
  REMODEL_ITEMS,
  SOURCE_STATUSES
} from "../constants.js";

/** zod's .url() accepts any scheme (javascript:, data:, …). These URLs are
 *  rendered as links in both frontends, so only http(s) is allowed. */
export const httpUrl = z
  .string()
  .url()
  .max(2000)
  .refine((u) => /^https?:\/\//i.test(u), {
    message: "Only http(s) URLs are allowed"
  });

export const remodelSchema = z.object({
  none: z.boolean().default(false),
  items: z.array(z.enum(REMODEL_ITEMS)).max(REMODEL_ITEMS.length).default([]),
  cost: z.number().min(0).max(10_000_000).nullable().default(null),
  comment: z.string().max(4000).default("")
});
export type Remodel = z.infer<typeof remodelSchema>;

/**
 * Note vs the artifact: pros/cons are arrays here (the artifact stored
 * newline-separated strings); the frontends join/split at the edge.
 */
const listingFields = {
  title: z.string().min(1).max(200),
  url: httpUrl.nullable().default(null),
  benchmark: z.boolean().default(false),
  /** Admin-controlled visibility: only published listings reach the client. */
  published: z.boolean().default(false),
  bezirk: z.enum(DISTRICT_NAMES),
  ortsteil: z.string().max(60).nullable().default(null),
  kiez: z.string().max(200).nullable().default(null),
  price: z.number().positive().max(100_000_000).nullable().default(null),
  sqm: z.number().positive().max(5000).nullable().default(null),
  /** German "Zimmer" count — includes the living room, can be fractional. */
  rooms: z.number().positive().max(30).nullable().default(null),
  beds: z.number().int().min(0).max(20).nullable().default(null),
  baths: z.number().positive().max(10).nullable().default(null),
  floor: z.string().max(50).nullable().default(null),
  /** Freeform display text, e.g. "1908, roof storey 2014". */
  year: z.string().max(40).nullable().default(null),
  /** Service charge (Hausgeld) €/month. */
  hausgeld: z.number().min(0).max(100_000).nullable().default(null),
  /** Buyer's commission % — null means "use the search default". */
  provision: z.number().min(0).max(10).nullable().default(null),
  balcony: z.enum(BALCONY_STATES).default("unknown"),
  balconyNote: z.string().max(300).nullable().default(null),
  status: z.enum(LISTING_STATUSES).default("new"),
  viewingAt: z.string().datetime({ offset: true }).nullable().default(null),
  contact: z.enum(CONTACT_STATUSES).default("none"),
  /** Comments from the viewing. */
  vComment: z.string().max(8000).default(""),
  /** Admin-private working notes (agent contact, documents requested…). */
  jjNotes: z.string().max(8000).default(""),
  /** The consultant's take, shown prominently to the client. */
  jjComments: z.string().max(8000).default(""),
  pros: z.array(z.string().min(1).max(300)).max(50).default([]),
  cons: z.array(z.string().min(1).max(300)).max(50).default([]),
  notes: z.string().max(8000).default(""),
  remodel: remodelSchema.nullable().default(null),
  /** 0 = not ranked, 1–5 = position in "JJ's top 5". */
  topRank: z.number().int().min(0).max(5).default(0)
};

export const listingCreateSchema = z.object(listingFields);
export type ListingCreateInput = z.infer<typeof listingCreateSchema>;

export const listingUpdateSchema = z.object(listingFields).partial();
export type ListingUpdateInput = z.infer<typeof listingUpdateSchema>;

export const listingSchema = z.object({
  id: z.string().ulid(),
  searchId: z.string().ulid(),
  ...listingFields,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type Listing = z.infer<typeof listingSchema>;

/**
 * Shape served to the customer app: admin-private fields stripped. Photos and
 * ratings are joined client-side from the media/engagement services, and cost
 * figures (all-in, €/m²) are computed in the frontend from the search
 * settings via the shared cost helpers — mirroring how the artifact worked.
 * Note: the artifact showed jjNotes to viewers; here they stay admin-private
 * (jjComments is the client-facing commentary).
 */
export const customerListingSchema = listingSchema.omit({
  jjNotes: true,
  published: true
});
export type CustomerListing = z.infer<typeof customerListingSchema>;

/** "score" sorting happens client-side (ratings live in engagement-svc). */
export const listingListQuerySchema = z.object({
  status: z.enum(LISTING_STATUSES).optional(),
  bezirk: z.enum(DISTRICT_NAMES).optional(),
  published: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  q: z.string().max(100).optional(),
  sort: z.enum(["new", "price", "sqm"]).default("new")
});
export type ListingListQuery = z.infer<typeof listingListQuerySchema>;

export const sourceCreateSchema = z.object({
  urls: z.array(httpUrl).min(1).max(50)
});

export const sourceSchema = z.object({
  id: z.string().ulid(),
  searchId: z.string().ulid(),
  url: httpUrl,
  status: z.enum(SOURCE_STATUSES),
  listingId: z.string().ulid().nullable(),
  addedAt: z.string().datetime()
});
export type Source = z.infer<typeof sourceSchema>;
