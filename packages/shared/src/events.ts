/**
 * EventBridge contracts. Every service publishes domain events to the shared
 * bus; the activity service consumes them for the audit log and the client
 * activity feed. Services never read each other's tables — events are the
 * only cross-service data flow.
 */
export const EVENT_SOURCES = {
  search: "jj.search",
  listing: "jj.listing",
  media: "jj.media",
  engagement: "jj.engagement",
  timesheet: "jj.timesheet",
  activity: "jj.activity",
  auth: "jj.auth"
} as const;
export type EventSource = (typeof EVENT_SOURCES)[keyof typeof EVENT_SOURCES];

export type DomainEventType =
  | "search.created"
  | "search.updated"
  | "search.archived"
  | "member.invited"
  | "member.removed"
  | "listing.created"
  | "listing.updated"
  | "listing.published"
  | "listing.unpublished"
  | "listing.deleted"
  | "listing.shared"
  | "listing.unshared"
  | "photo.added"
  | "photo.deleted"
  | "rating.saved"
  | "rating.removed"
  | "comment.created"
  | "comment.deleted"
  | "hours.logged"
  | "hours.updated"
  | "hours.deleted"
  | "hours.paid"
  | "client.signed_in"
  | "client.activity"
  | "admin.action";

export type ActorRole = "admin" | "client" | "viewer" | "system";

export interface DomainEvent {
  type: DomainEventType;
  /** The search (client engagement) this event belongs to, when applicable. */
  searchId?: string;
  listingId?: string;
  actorId: string;
  actorName?: string;
  actorRole: ActorRole;
  /** ISO timestamp. */
  at: string;
  /** One-line human-readable summary shown in the admin activity feed. */
  summary: string;
  /** Event-specific payload. For admin.action: { action, entity, entityId, before?, after? }. */
  payload?: Record<string, unknown>;
}

/** detail-type used on the bus is the DomainEvent.type verbatim. */
export const EVENT_BUS_NAME_ENV = "EVENT_BUS_NAME";
