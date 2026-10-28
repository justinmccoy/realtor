import type { EventBridgeHandler } from "aws-lambda";
import { logger } from "@jj/lambda-kit";
import type { DomainEvent } from "@jj/shared";
import * as repo from "../repo.js";
import * as s3 from "../s3.js";

/**
 * Consumes listing-service domain events:
 *  - listing.published / listing.unpublished → event-carried visibility flag
 *    (lets the customer photo endpoint filter without cross-service reads)
 *  - listing.deleted → remove photo metadata and S3 objects
 */
export const handler: EventBridgeHandler<string, DomainEvent, void> = async (
  event
) => {
  const detail = event.detail;
  const { listingId, searchId } = detail;
  if (!listingId) {
    logger.warn("listing event without listingId", { type: event["detail-type"] });
    return;
  }
  switch (event["detail-type"]) {
    case "listing.published":
      await repo.setPublished(listingId, searchId ?? "", true);
      break;
    case "listing.unpublished":
      await repo.setPublished(listingId, searchId ?? "", false);
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
