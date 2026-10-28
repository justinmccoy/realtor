import type { ClientEventType, ListingEngagement } from "@jj/shared";

/** Activity feed records live 180 days; the audit log is kept forever. */
export const ACTIVITY_TTL_DAYS = 180;

export function ttlEpoch(nowMs: number): number {
  return Math.floor(nowMs / 1000) + ACTIVITY_TTL_DAYS * 86_400;
}

/** Which engagement counter a client event increments (if any). */
export function rollupField(
  type: ClientEventType
): keyof Pick<
  ListingEngagement,
  "expands" | "photoViews" | "exposeClicks" | "mapClicks"
> | null {
  switch (type) {
    case "listing_expanded":
      return "expands";
    case "photo_viewed":
    case "floorplan_viewed":
      return "photoViews";
    case "expose_clicked":
      return "exposeClicks";
    case "map_clicked":
      return "mapClicks";
    default:
      return null;
  }
}

/** Human line for the admin feed; listing titles are joined in the admin UI. */
export function clientEventSummary(
  actorName: string,
  type: ClientEventType
): string {
  switch (type) {
    case "session_start":
      return `${actorName} opened the site`;
    case "listing_expanded":
      return `${actorName} opened a listing's details`;
    case "photo_viewed":
      return `${actorName} looked at photos`;
    case "floorplan_viewed":
      return `${actorName} looked at a floor plan`;
    case "expose_clicked":
      return `${actorName} opened the original exposé`;
    case "map_clicked":
      return `${actorName} opened the map`;
    case "brief_viewed":
      return `${actorName} read the search requirements`;
    case "hours_viewed":
      return `${actorName} viewed the hours ledger`;
  }
}
