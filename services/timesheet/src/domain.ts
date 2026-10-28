import type { HoursEntry, HoursUpdateInput } from "@jj/shared";

/* Pure domain logic (unit-tested). */

export function mergeEntry(
  existing: HoursEntry,
  patch: HoursUpdateInput,
  now: string
): HoursEntry {
  const merged: HoursEntry = {
    ...existing,
    ...patch,
    paid: patch.paid ?? existing.paid,
    paidAt: existing.paidAt
  };
  if (patch.paid === true && !existing.paid) merged.paidAt = now;
  if (patch.paid === false) merged.paidAt = null;
  return merged;
}

export function entriesInMonth(
  entries: HoursEntry[],
  month: string
): HoursEntry[] {
  return entries.filter((e) => e.date.startsWith(month));
}

export function sortEntries(entries: HoursEntry[]): HoursEntry[] {
  return [...entries].sort(
    (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)
  );
}

/** "1h 30m" / "45m" — used in activity summaries, mirrors the artifact. */
export function fmtMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

/** Timer stop → whole minutes, minimum 1 (as in the artifact). */
export function timerMinutes(startedAtIso: string, now: Date): number {
  const started = new Date(startedAtIso).getTime();
  return Math.max(1, Math.round((now.getTime() - started) / 60_000));
}

/** Local-date (YYYY-MM-DD) for a timestamp — the artifact logged timer
 *  entries on the day the timer started. Uses UTC; Berlin-offset drift at
 *  midnight is acceptable for a time ledger. */
export function dateOf(iso: string): string {
  return iso.slice(0, 10);
}
