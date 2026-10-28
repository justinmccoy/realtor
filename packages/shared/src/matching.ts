import { z } from "zod";
import { allInCost } from "./costs.js";
import type { Listing } from "./schemas/listing.js";
import type { Brief, Settings } from "./schemas/search.js";

/**
 * Visibility model: listings live in one global pool. A client sees a listing
 * when it is Active (not a draft) AND (manually shared with their search, OR
 * it matches their brief and hasn't been manually hidden).
 */
export const SHARE_MODES = ["shared", "hidden"] as const;
export type ShareMode = (typeof SHARE_MODES)[number];

export const sharePutSchema = z.object({ mode: z.enum(SHARE_MODES) });

export const shareSchema = z.object({
  searchId: z.string().ulid(),
  listingId: z.string().ulid(),
  mode: z.enum(SHARE_MODES),
  at: z.string().datetime()
});
export type Share = z.infer<typeof shareSchema>;

type MatchListing = Pick<
  Listing,
  "price" | "provision" | "sqm" | "beds" | "bezirk" | "ortsteil" | "kiez" | "title"
>;

/** An empty brief matches nothing — a new client must not inherit the whole
 *  pool before their criteria are set. */
export function briefHasCriteria(brief: Brief, settings: Settings): boolean {
  return Boolean(
    brief.budget ||
      settings.budget ||
      brief.minSqm ||
      brief.minBeds ||
      brief.districts.length ||
      brief.ortsteile.length
  );
}

/** Every criterion that is set must pass; unknown listing values fail the
 *  criterion (an unpriced listing can't "match a budget" — share it manually). */
export function matchesBrief(
  listing: MatchListing,
  brief: Brief,
  settings: Settings
): boolean {
  if (!briefHasCriteria(brief, settings)) return false;

  const budget = brief.budget || settings.budget || 0;
  if (budget > 0) {
    const cost = allInCost(listing.price, settings, listing.provision);
    if (!cost || cost.total > budget) return false;
  }
  if (brief.minSqm > 0 && !(listing.sqm != null && listing.sqm >= brief.minSqm)) {
    return false;
  }
  if (brief.minBeds > 0 && !(listing.beds != null && listing.beds >= brief.minBeds)) {
    return false;
  }
  if (brief.districts.length || brief.ortsteile.length) {
    const inDistrict = brief.districts.includes(listing.bezirk);
    const hay =
      `${listing.ortsteil ?? ""} ${listing.kiez ?? ""} ${listing.title}`.toLowerCase();
    const inOrt = listing.ortsteil
      ? brief.ortsteile.includes(listing.ortsteil)
      : brief.ortsteile.some((o) => hay.includes(o.toLowerCase()));
    if (!inDistrict && !inOrt) return false;
  }
  return true;
}

export type VisibilityReason = "shared" | "match" | "hidden" | "no-match" | "draft";

export function visibility(
  listing: MatchListing & { published: boolean },
  brief: Brief,
  settings: Settings,
  share: ShareMode | undefined
): { visible: boolean; reason: VisibilityReason } {
  if (!listing.published) return { visible: false, reason: "draft" };
  if (share === "shared") return { visible: true, reason: "shared" };
  if (share === "hidden") return { visible: false, reason: "hidden" };
  return matchesBrief(listing, brief, settings)
    ? { visible: true, reason: "match" }
    : { visible: false, reason: "no-match" };
}
