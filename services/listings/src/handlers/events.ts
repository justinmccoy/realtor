import type { EventBridgeHandler } from "aws-lambda";
import { logger } from "@jj/lambda-kit";
import type { DomainEvent } from "@jj/shared";
import * as repo from "../repo.js";

/**
 * Keeps the per-search matching criteria (brief + settings) current from
 * search-service events, so customer reads can resolve auto-match visibility
 * without cross-service table access.
 */
export const handler: EventBridgeHandler<string, DomainEvent, void> = async (
  event
) => {
  const d = event.detail;
  if (!d.searchId) return;
  const payload = (d.payload ?? {}) as {
    brief?: unknown;
    settings?: unknown;
    status?: unknown;
  };
  switch (event["detail-type"]) {
    case "search.created":
    case "search.updated":
    case "search.archived":
      await repo.putCriteria(d.searchId, payload);
      logger.info("criteria updated", { searchId: d.searchId });
      break;
    default:
      logger.debug("ignoring event", { type: event["detail-type"] });
  }
};
