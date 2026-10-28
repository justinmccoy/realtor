import {
  EventBridgeClient,
  PutEventsCommand
} from "@aws-sdk/client-eventbridge";
import {
  EVENT_BUS_NAME_ENV,
  type DomainEvent,
  type EventSource
} from "@jj/shared";
import { logger } from "./logger.js";
import type { AdminAuth } from "./auth.js";

let client: EventBridgeClient | undefined;

function eb(): EventBridgeClient {
  if (!client) {
    client = new EventBridgeClient(
      process.env.EVENTS_ENDPOINT ? { endpoint: process.env.EVENTS_ENDPOINT } : {}
    );
  }
  return client;
}

/**
 * Publish domain events to the shared bus. Never throws: a failed event
 * must not fail the user-facing write it describes (it is logged and
 * alarmed on instead).
 */
export async function publishEvents(
  source: EventSource,
  events: DomainEvent | DomainEvent[]
): Promise<void> {
  const busName = process.env[EVENT_BUS_NAME_ENV];
  const list = Array.isArray(events) ? events : [events];
  if (!busName) {
    logger.warn("EVENT_BUS_NAME not set; dropping domain events", {
      count: list.length
    });
    return;
  }
  try {
    await eb().send(
      new PutEventsCommand({
        Entries: list.map((e) => ({
          EventBusName: busName,
          Source: source,
          DetailType: e.type,
          Detail: JSON.stringify(e)
        }))
      })
    );
  } catch (err) {
    logger.error("failed to publish domain events", err as Error);
  }
}

/** Convenience wrapper for the admin audit trail. */
export async function publishAdminAction(
  source: EventSource,
  admin: AdminAuth,
  input: {
    action: string;
    entity: string;
    entityId: string;
    searchId?: string;
    listingId?: string;
    summary: string;
    before?: unknown;
    after?: unknown;
  }
): Promise<void> {
  await publishEvents(source, {
    type: "admin.action",
    searchId: input.searchId,
    listingId: input.listingId,
    actorId: admin.userId,
    actorName: admin.displayName,
    actorRole: "admin",
    at: new Date().toISOString(),
    summary: input.summary,
    payload: {
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      before: input.before ?? null,
      after: input.after ?? null
    }
  });
}
