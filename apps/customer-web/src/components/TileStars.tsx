import { useState } from "react";
import type { Rating } from "@jj/shared";
import { api } from "../api/client";

/**
 * Star rating in a board tile's top row, between the district plate and
 * the status pill.
 * Shows the caller's own rating; the stars stay empty until they rate.
 * Members with edit access can hover to preview and click to save a score
 * without opening the listing; viewers get a read-only version. The
 * average from everyone is only in the tooltip.
 */
export function TileStars({
  searchId,
  listingId,
  ratings,
  myName,
  canRate,
  onChanged
}: {
  searchId: string;
  listingId: string;
  ratings: Rating[];
  myName: string;
  canRate: boolean;
  onChanged: () => void;
}) {
  const forListing = ratings.filter((r) => r.listingId === listingId);
  const mine = forListing.find((r) => r.authorName === myName);
  const avg = forListing.length
    ? forListing.reduce((a, r) => a + r.score, 0) / forListing.length
    : 0;
  const shown = mine?.score ?? 0;

  const [hover, setHover] = useState(0);
  const [saving, setSaving] = useState(0);
  const [failed, setFailed] = useState(false);
  const live = hover || saving || shown;

  const label = forListing.length
    ? `${avg.toFixed(1)} of 5 from ${forListing.length} rating${forListing.length > 1 ? "s" : ""}${
        mine ? `, yours ${mine.score}` : ""
      }`
    : "No ratings yet";

  async function pick(score: number) {
    if (saving) return;
    setSaving(score);
    setFailed(false);
    try {
      await api.putRating(searchId, listingId, { score, comment: mine?.comment ?? "" });
      onChanged();
    } catch {
      setFailed(true);
    } finally {
      setSaving(0);
    }
  }

  return (
    <div
      className={`tile-stars${mine ? " mine" : ""}${saving ? " saving" : ""}${failed ? " failed" : ""}`}
      role={canRate ? "group" : undefined}
      aria-label={canRate ? `Rate this apartment. ${label}` : label}
      title={failed ? "Couldn't save your rating" : label}
      onMouseLeave={() => setHover(0)}
    >
      {[1, 2, 3, 4, 5].map((i) =>
        canRate ? (
          <button
            key={i}
            type="button"
            className={`ts${i <= live ? " on" : ""}`}
            aria-label={`${i} star${i > 1 ? "s" : ""}`}
            aria-pressed={mine?.score === i}
            disabled={saving > 0}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(0)}
            onClick={() => void pick(i)}
          >
            ★
          </button>
        ) : (
          <span key={i} className={`ts${i <= live ? " on" : ""}`} aria-hidden="true">
            ★
          </span>
        )
      )}
    </div>
  );
}
