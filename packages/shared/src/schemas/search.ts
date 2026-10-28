import { z } from "zod";
import { DISTRICT_NAMES } from "../berlin.js";
import { DEFAULT_SETTINGS, MEMBER_ROLES } from "../constants.js";

export const settingsSchema = z.object({
  /** Hourly rate €. 0 hides money amounts in the client-facing hours ledger. */
  rate: z.number().min(0).max(10000).default(DEFAULT_SETTINGS.rate),
  /** Property transfer tax %. */
  gre: z.number().min(0).max(20).default(DEFAULT_SETTINGS.gre),
  /** Notary + land registry %. */
  notary: z.number().min(0).max(10).default(DEFAULT_SETTINGS.notary),
  /** Default buyer's commission %. */
  provision: z.number().min(0).max(10).default(DEFAULT_SETTINGS.provision),
  /** Max all-in budget €. 0 = open. */
  budget: z.number().min(0).max(100_000_000).default(DEFAULT_SETTINGS.budget)
});
export type Settings = z.infer<typeof settingsSchema>;

export const briefSchema = z.object({
  budget: z.number().min(0).max(100_000_000).default(0),
  minSqm: z.number().min(0).max(2000).default(0),
  minBeds: z.number().int().min(0).max(20).default(0),
  districts: z.array(z.enum(DISTRICT_NAMES)).max(12).default([]),
  ortsteile: z.array(z.string().min(1).max(60)).max(100).default([]),
  timeline: z.string().max(200).default(""),
  must: z.array(z.string().min(1).max(200)).max(50).default([]),
  nice: z.array(z.string().min(1).max(200)).max(50).default([]),
  no: z.array(z.string().min(1).max(200)).max(50).default([]),
  notes: z.string().max(8000).default("")
});
export type Brief = z.infer<typeof briefSchema>;

export const searchCreateSchema = z.object({
  clientName: z.string().min(1).max(100),
  settings: settingsSchema.partial().optional()
});
export type SearchCreateInput = z.infer<typeof searchCreateSchema>;

export const searchUpdateSchema = z.object({
  clientName: z.string().min(1).max(100).optional(),
  status: z.enum(["active", "archived"]).optional(),
  settings: settingsSchema.partial().optional()
});
export type SearchUpdateInput = z.infer<typeof searchUpdateSchema>;

export const searchSchema = z.object({
  id: z.string().ulid(),
  clientName: z.string(),
  status: z.enum(["active", "archived"]),
  settings: settingsSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type Search = z.infer<typeof searchSchema>;

export const memberSchema = z.object({
  userId: z.string().min(1),
  searchId: z.string().ulid(),
  email: z.string().email(),
  displayName: z.string().min(1).max(100),
  role: z.enum(MEMBER_ROLES),
  invitedAt: z.string().datetime(),
  lastSeenAt: z.string().datetime().nullable()
});
export type Member = z.infer<typeof memberSchema>;

export const inviteSchema = z.object({
  email: z.string().email().max(254),
  displayName: z.string().min(1).max(100),
  role: z.enum(MEMBER_ROLES).default("client")
});
export type InviteInput = z.infer<typeof inviteSchema>;
