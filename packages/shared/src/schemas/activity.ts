import { z } from "zod";

/** Client-side interaction events, batched from customer-web. */
export const CLIENT_EVENT_TYPES = [
  "session_start",
  "listing_expanded",
  "photo_viewed",
  "floorplan_viewed",
  "expose_clicked",
  "map_clicked",
  "brief_viewed",
  "hours_viewed"
] as const;
export type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number];

export const clientEventsBatchSchema = z.object({
  searchId: z.string().ulid(),
  events: z
    .array(
      z.object({
        type: z.enum(CLIENT_EVENT_TYPES),
        listingId: z.string().ulid().optional(),
        at: z.string().datetime({ offset: true }),
        meta: z.record(z.union([z.string(), z.number(), z.boolean()])).optional()
      })
    )
    .min(1)
    .max(50)
});
export type ClientEventsBatch = z.infer<typeof clientEventsBatchSchema>;

export const activityRecordSchema = z.object({
  id: z.string(),
  searchId: z.string().nullable(),
  listingId: z.string().nullable(),
  type: z.string(),
  actorId: z.string(),
  actorName: z.string(),
  actorRole: z.enum(["admin", "client", "viewer", "system"]),
  summary: z.string(),
  at: z.string().datetime(),
  payload: z.record(z.unknown()).nullable()
});
export type ActivityRecord = z.infer<typeof activityRecordSchema>;

export const activityQuerySchema = z.object({
  searchId: z.string().ulid().optional(),
  actorId: z.string().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional()
});

export const auditQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  adminId: z.string().optional(),
  entity: z.string().optional()
});

/** Per-listing engagement rollup served to the admin dashboard. */
export const listingEngagementSchema = z.object({
  listingId: z.string(),
  expands: z.number().int(),
  photoViews: z.number().int(),
  exposeClicks: z.number().int(),
  mapClicks: z.number().int(),
  lastViewedAt: z.string().datetime().nullable()
});
export type ListingEngagement = z.infer<typeof listingEngagementSchema>;
