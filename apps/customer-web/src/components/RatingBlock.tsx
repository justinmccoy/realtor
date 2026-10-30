import { useState } from "react";
import type { Rating } from "@jj/shared";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

/**
 * Rating section on the listing page.
 * Members with edit access rate in place: hover previews a score, a click
 * saves it (the same interaction as the stars on the board tiles). Any
 * comment they left before is preserved. Viewers get read-only stars
 * showing the average.
 */
export function RatingBlock({
  searchId,
  listingId,
  ratings,
  myUserIdHint,
  canRate,
  onChanged
}: {
  searchId: string;
  listingId: string;
  ratings: Rating[];
  /** The caller's rating is matched by authorName fallback when sub unknown. */
  myUserIdHint: string;
  canRate: boolean;
  onChanged: () => void;
}) {
  const auth = useAuth();
  const forListing = ratings.filter((r) => r.listingId === listingId);
  const mine = forListing.find(
    (r) => r.userId === myUserIdHint || r.authorName === auth.name
  );
  const others = forListing.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const avg = forListing.length
    ? forListing.reduce((a, r) => a + r.score, 0) / forListing.length
    : 0;

  const [hover, setHover] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // Editors see their own score (hover previews a new one); viewers see the average.
  const live = canRate ? hover || mine?.score || 0 : Math.round(avg);

  const summary = forListing.length
    ? `${avg.toFixed(1)} · ${forListing.length} rating${forListing.length > 1 ? "s" : ""}`
    : "No ratings yet";

  async function pick(score: number) {
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      await api.putRating(searchId, listingId, { score, comment: mine?.comment ?? "" });
      onChanged();
      setMsg("Rating saved");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't save your rating");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      await api.removeRating(searchId, listingId);
      onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't remove your rating");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rating">
      <div
        className={`stars${busy ? " saving" : ""}`}
        role={canRate ? "group" : undefined}
        aria-label={
          canRate
            ? `Rate this apartment. ${summary}${mine ? `, yours ${mine.score}` : ""}`
            : summary
        }
        onMouseLeave={() => setHover(0)}
      >
        {[1, 2, 3, 4, 5].map((i) =>
          canRate ? (
            <button
              key={i}
              type="button"
              className={`star${i <= live ? " on" : ""}`}
              aria-label={`${i} star${i > 1 ? "s" : ""}`}
              aria-pressed={mine?.score === i}
              disabled={busy}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(0)}
              onClick={() => void pick(i)}
            >
              ★
            </button>
          ) : (
            <span key={i} className={`star${i <= live ? " on" : ""}`} aria-hidden="true">
              ★
            </span>
          )
        )}
        <span className="rlabel">{summary}</span>
        {canRate && mine && (
          <button
            className="btn ghost danger rbtn"
            type="button"
            disabled={busy}
            onClick={() => void remove()}
          >
            Remove my rating
          </button>
        )}
      </div>
      {canRate && (
        <p className="note-line" style={{ margin: 0 }} aria-live="polite">
          {msg || (mine ? "Click a star to change your rating." : "Click a star to rate.")}
        </p>
      )}
      {!canRate && (
        <p className="note-line" style={{ margin: 0 }}>
          You have view-only access, so you can see ratings but not add your own.
        </p>
      )}

      {others.length > 0 && (
        <ul className="rlist">
          {others.map((r) => (
            <li key={r.userId}>
              <span className="rwho">
                {r.authorName}
                {mine && r.userId === mine.userId ? " (you)" : ""}
              </span>
              <span className="rmini">
                {"★".repeat(r.score)}
                <span className="off">{"★".repeat(5 - r.score)}</span>
              </span>
              {r.comment && <span className="rtext">{r.comment}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
