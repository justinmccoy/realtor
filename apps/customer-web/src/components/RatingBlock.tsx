import { useState } from "react";
import type { Rating } from "@jj/shared";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

function Stars({
  score,
  onPick
}: {
  score: number;
  onPick?: (v: number) => void;
}) {
  return (
    <span className="stars">
      {[1, 2, 3, 4, 5].map((i) =>
        onPick ? (
          <button
            key={i}
            type="button"
            className={`star${i <= score ? " on" : ""}`}
            aria-label={`${i} star${i > 1 ? "s" : ""}`}
            onClick={() => onPick(i)}
          >
            ★
          </button>
        ) : (
          <span key={i} className={`star${i <= Math.round(score) ? " on" : ""}`}>
            ★
          </span>
        )
      )}
    </span>
  );
}

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

  const [pick, setPick] = useState(0);
  const [comment, setComment] = useState(mine?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function save() {
    const score = pick || mine?.score || 0;
    if (!score) {
      setMsg("Pick 1 to 5 stars first");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      await api.putRating(searchId, listingId, { score, comment: comment.trim() });
      onChanged();
      setMsg("Rating saved");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't save your rating");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.removeRating(searchId, listingId);
      setPick(0);
      setComment("");
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rating">
      <div
        className="stars"
        aria-label={
          forListing.length
            ? `Average ${avg.toFixed(1)} of 5 from ${forListing.length} rating${forListing.length > 1 ? "s" : ""}`
            : "No ratings yet"
        }
      >
        <Stars score={avg} />
        <span className="rlabel">
          {forListing.length
            ? `${avg.toFixed(1)} · ${forListing.length} rating${forListing.length > 1 ? "s" : ""}`
            : "No ratings yet"}
        </span>
      </div>

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

      {canRate ? (
        <details className="myrate">
          <summary>{mine ? "Change your rating" : "Rate this apartment"}</summary>
          <Stars score={pick || mine?.score || 0} onPick={setPick} />
          <textarea
            aria-label="Your comment"
            placeholder="What do you think?"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            {msg && <span className="note-line">{msg}</span>}
            {mine && (
              <button
                className="btn ghost danger"
                type="button"
                disabled={busy}
                onClick={() => void remove()}
              >
                Remove
              </button>
            )}
            <button
              className="btn primary"
              type="button"
              disabled={busy}
              onClick={() => void save()}
            >
              Save rating
            </button>
          </div>
        </details>
      ) : (
        <div className="myrate">
          <p className="note-line" style={{ margin: 0 }}>
            You have view-only access, so you can see ratings but not add your own.
          </p>
        </div>
      )}
    </div>
  );
}
