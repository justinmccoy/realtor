/** Listing pipeline, taken verbatim from the artifact. */
export const LISTING_STATUSES = [
  "new",
  "short",
  "viewing",
  "viewed",
  "offer",
  "passed"
] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const LISTING_STATUS_LABELS: Record<ListingStatus, string> = {
  new: "New",
  short: "Shortlisted",
  viewing: "Viewing booked",
  viewed: "Viewed",
  offer: "Offer made",
  passed: "Passed"
};

export const CONTACT_STATUSES = [
  "none",
  "contacted",
  "requested",
  "confirmed",
  "viewed",
  "noreply",
  "declined"
] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export const CONTACT_STATUS_LABELS: Record<ContactStatus, string> = {
  none: "Not contacted",
  contacted: "Contacted, awaiting reply",
  requested: "Viewing requested",
  confirmed: "Viewing confirmed",
  viewed: "Viewed",
  noreply: "No response",
  declined: "Declined / unavailable"
};

export const HOURS_CATEGORIES = [
  "Research",
  "Viewing",
  "Calls & email",
  "Paperwork",
  "Travel",
  "Other"
] as const;
export type HoursCategory = (typeof HOURS_CATEGORIES)[number];

export const REMODEL_ITEMS = [
  "Cosmetic (paint, walls)",
  "Floors",
  "Kitchen",
  "Bathroom",
  "Electrics",
  "Plumbing",
  "Heating",
  "Windows",
  "Layout changes",
  "Full renovation"
] as const;
export type RemodelItem = (typeof REMODEL_ITEMS)[number];

export const BALCONY_STATES = ["yes", "no", "unknown"] as const;
export type BalconyState = (typeof BALCONY_STATES)[number];

export const MEMBER_ROLES = ["client", "viewer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const PHOTO_KINDS = ["photo", "floorplan"] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];

export const SOURCE_STATUSES = ["pending", "failed", "done"] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

/** Every API route lives under this prefix so CloudFront can route
 *  `/api/*` straight to API Gateway without path rewriting. */
export const API_PREFIX = "/api/v1";

/** Default cost settings for a new search (Berlin figures from the artifact). */
export const DEFAULT_SETTINGS = {
  rate: 0,
  gre: 6,
  notary: 2,
  provision: 3.57,
  budget: 0
} as const;
