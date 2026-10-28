import type { ClientEventType } from "@jj/shared";
import { api } from "./api/client";

/**
 * Interaction tracking: UI events are queued and flushed in batches to the
 * activity service — every 15s, at 20 queued events, and when the tab hides.
 * First-party only, tied to the signed-in member; failures are dropped
 * silently (tracking must never break the app).
 */
interface Queued {
  type: ClientEventType;
  listingId?: string;
  at: string;
  meta?: Record<string, string | number | boolean>;
}

let searchId: string | null = null;
let queue: Queued[] = [];
let timer: ReturnType<typeof setInterval> | undefined;

async function flush(): Promise<void> {
  if (!searchId || queue.length === 0) return;
  const events = queue.splice(0, 50);
  try {
    await api.postEvents({ searchId, events });
  } catch {
    /* drop — tracking is best-effort */
  }
}

export function initTracking(sid: string): void {
  searchId = sid;
  queue = [];
  if (!timer) {
    timer = setInterval(() => void flush(), 15_000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void flush();
    });
  }
  track("session_start");
}

export function track(
  type: ClientEventType,
  listingId?: string,
  meta?: Record<string, string | number | boolean>
): void {
  if (!searchId) return;
  queue.push({ type, listingId, at: new Date().toISOString(), meta });
  if (queue.length >= 20) void flush();
}
