import type { EventBridgeHandler } from "aws-lambda";
import { logger, newId } from "@jj/lambda-kit";
import type { DomainEvent } from "@jj/shared";
import * as repo from "../repo.js";

/**
 * The event sink: every domain event on the bus lands here.
 *  - admin.action  → permanent audit log (who changed what, when, before/after)
 *  - everything else → the per-search activity feed (180-day TTL)
 */
export const handler: EventBridgeHandler<string, DomainEvent, void> = async (
  event
) => {
  const d = event.detail;
  if (event["detail-type"] === "admin.action") {
    const p = (d.payload ?? {}) as {
      action?: string;
      entity?: string;
      entityId?: string;
      before?: unknown;
      after?: unknown;
    };
    await repo.putAudit({
      at: d.at,
      adminId: d.actorId,
      adminName: d.actorName ?? "Admin",
      action: p.action ?? "unknown",
      entity: p.entity ?? "unknown",
      entityId: p.entityId ?? "",
      searchId: d.searchId ?? null,
      summary: d.summary,
      before: p.before ?? null,
      after: p.after ?? null
    });
    return;
  }

  if (!d.searchId) {
    logger.debug("skipping non-search event", { type: event["detail-type"] });
    return;
  }
  await repo.putActivity({
    id: newId(),
    searchId: d.searchId,
    listingId: d.listingId ?? null,
    type: d.type,
    actorId: d.actorId,
    actorName: d.actorName ?? "",
    actorRole: d.actorRole,
    summary: d.summary,
    at: d.at,
    payload: (d.payload as Record<string, unknown> | undefined) ?? null
  });
};
