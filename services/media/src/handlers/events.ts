import type { EventBridgeHandler } from "aws-lambda";
import { logger } from "@jj/lambda-kit";
import type { DomainEvent } from "@jj/shared";
import * as repo from "../repo.js";
import * as s3 from "../s3.js";

/**
 * Consumes listing-service domain events:
 *  - listing.created/updated carry payload.published → keep the active flag
 *  - listing.published / listing.unpublished → flip it
 *  - listing.deleted → remove photo metadata and S3 objects
 */
export const handler: EventBridgeHandler<string, DomainEvent, void> = async (
  event
) => {
  const detail = event.detail;
  const { listingId } = detail;
  if (!listingId) {
    logger.warn("listing event without listingId", { type: event["detail-type"] });
    return;
  }
  const payload = (detail.payload ?? {}) as { published?: boolean };
  switch (event["detail-type"]) {
    case "listing.created":
    case "listing.updated":
      await repo.setPublished(listingId, payload.published ?? false);
      break;
    case "listing.published":
      await repo.setPublished(listingId, true);
      break;
    case "listing.unpublished":
      await repo.setPublished(listingId, false);
      break;
    case "listing.deleted": {
      const keys = await repo.deleteAllForListing(listingId);
      if (keys.length) await s3.deleteObjectsBatch(keys);
      logger.info("cleaned up media for deleted listing", {
        listingId,
        photos: keys.length
      });
      break;
    }
    default:
      logger.debug("ignoring event", { type: event["detail-type"] });
  }
};
