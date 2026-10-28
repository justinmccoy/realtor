import { z } from "zod";
import { HOURS_CATEGORIES } from "../constants.js";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const hoursCreateSchema = z.object({
  date: dateOnly,
  minutes: z.number().int().min(1).max(24 * 60),
  category: z.enum(HOURS_CATEGORIES),
  listingId: z.string().ulid().nullable().default(null),
  note: z.string().max(500).default("")
});
export type HoursCreateInput = z.infer<typeof hoursCreateSchema>;

export const hoursUpdateSchema = hoursCreateSchema.partial().extend({
  paid: z.boolean().optional()
});
export type HoursUpdateInput = z.infer<typeof hoursUpdateSchema>;

export const hoursEntrySchema = z.object({
  id: z.string().ulid(),
  searchId: z.string().ulid(),
  date: dateOnly,
  minutes: z.number().int(),
  category: z.enum(HOURS_CATEGORIES),
  listingId: z.string().ulid().nullable(),
  note: z.string(),
  paid: z.boolean(),
  paidAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime()
});
export type HoursEntry = z.infer<typeof hoursEntrySchema>;

export const payMonthSchema = z.object({
  /** YYYY-MM */
  month: z.string().regex(/^\d{4}-\d{2}$/, "Expected YYYY-MM")
});

export const timerPutSchema = z.object({
  category: z.enum(HOURS_CATEGORIES),
  note: z.string().max(500).default("")
});

export const timerSchema = z.object({
  searchId: z.string().ulid(),
  startedAt: z.string().datetime(),
  category: z.enum(HOURS_CATEGORIES),
  note: z.string()
});
export type Timer = z.infer<typeof timerSchema>;
