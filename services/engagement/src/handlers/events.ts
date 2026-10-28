import type { EventBridgeHandler } from "aws-lambda";
import { logger } from "@jj/lambda-kit";
import type { DomainEvent } from "@jj/shared";
import * as repo from "../repo.js";

/**
 * Consumes listing-service events to keep an event-carried copy of listing
 * identity/visibility ({searchId, title, published}) used to validate
 * customer writes without cross-service table reads. On deletion, the
 * listing's ratings go with it; comments are kept for the discussion history.
 */
export const handler: EventBridgeHandler<string, DomainEvent, void> = async (
  event
) => {
  const d = event.detail;
  if (!d.listingId || !d.searchId) {
    logger.warn("listing event missing ids", { type: event["detail-type"] });
    return;
  }
  const payload = (d.payload ?? {}) as { title?: string; published?: boolean };

  switch (event["detail-type"]) {
    case "listing.created":
    case "listing.updated":
    case "listing.published":
    case "listing.unpublished": {
      const existing = await repo.getListingMeta(d.listingId);
      await repo.setListingMeta(d.listingId, {
        searchId: d.searchId,
        title: payload.title ?? existing?.title ?? "",
        published:
          event["detail-type"] === "listing.published"
            ? true
            : event["detail-type"] === "listing.unpublished"
              ? false
              : (payload.published ?? existing?.published ?? false)
      });
      break;
    }
    case "listing.deleted":
      await repo.deleteRatingsForListing(d.listingId);
      await repo.deleteListingMeta(d.listingId);
      logger.info("cleaned up engagement for deleted listing", {
        listingId: d.listingId
      });
      break;
    default:
      logger.debug("ignoring event", { type: event["detail-type"] });
  }
};
