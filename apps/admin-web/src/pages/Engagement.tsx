import { useCallback, useEffect, useState } from "react";
import type {
  ActivityRecord,
  Comment,
  Listing,
  ListingEngagement,
  Rating
} from "@jj/shared";
import { api } from "../api/client";
import { fmtWhen } from "../lib/format";
import { DangerButton, useToast } from "../components/ui";

export function Engagement({ searchId }: { searchId: string }) {
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [rollups, setRollups] = useState<ListingEngagement[]>([]);
  const [feed, setFeed] = useState<ActivityRecord[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [reply, setReply] = useState<Record<string, string>>({});
  const [toastEl, toast] = useToast();

  const reload = useCallback(async () => {
    const [r, c, e, f, l] = await Promise.all([
      api.ratings(searchId),
      api.comments(searchId),
      api.engagement(searchId),
      api.activity({ searchId, limit: 50 }),
      api.listings()
    ]);
    setRatings(r.items);
    setComments(c.items);
    setRollups(e.items);
    setFeed(f.items);
    setListings(l.items);
  }, [searchId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const title = (id: string | null) =>
    id ? (listings.find((l) => l.id === id)?.title ?? "(deleted listing)") : "the search";

  return (
    <div className="dash-grid">
      <section className="panel">
        <h2>Listing engagement</h2>
        {rollups.length === 0 ? (
          <p className="note-line">
            No client interactions recorded yet — expands, photo views and link
            clicks will show up here.
          </p>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Listing</th>
                  <th>Expands</th>
                  <th>Photos</th>
                  <th>Exposé</th>
                  <th>Map</th>
                  <th>Last viewed</th>
                </tr>
              </thead>
              <tbody>
                {[...rollups]
                  .sort((a, b) => b.expands - a.expands)
                  .map((r) => (
                    <tr key={r.listingId}>
                      <td>{title(r.listingId)}</td>
                      <td className="num">{r.expands}</td>
                      <td className="num">{r.photoViews}</td>
                      <td className="num">{r.exposeClicks}</td>
                      <td className="num">{r.mapClicks}</td>
                      <td className="muted">
                        {r.lastViewedAt ? fmtWhen(r.lastViewedAt) : "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Ratings</h2>
        {ratings.length === 0 ? (
          <p className="note-line">No ratings yet.</p>
        ) : (
          <ul className="rlist">
            {ratings.map((r) => (
              <li key={`${r.listingId}-${r.userId}`}>
                <span className="rwho">{r.authorName}</span>
                <span className="rmini">
                  {"★".repeat(r.score)}
                  <span className="off">{"★".repeat(5 - r.score)}</span>
                </span>
                <span className="muted">{title(r.listingId)}</span>
                {r.comment && <span className="rtext">{r.comment}</span>}
                <DangerButton
                  label="Remove"
                  onConfirm={() =>
                    void api.deleteRating(searchId, r.listingId, r.userId).then(() => {
                      toast("Rating removed");
                      return reload();
                    })
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>Comments</h2>
        {comments.length === 0 ? (
          <p className="note-line">No comments yet.</p>
        ) : (
          <ul className="cmt-list feed" style={{ display: "flex", flexDirection: "column" }}>
            {comments.map((c) => (
              <li key={c.id} style={{ gridTemplateColumns: "1fr" }}>
                <span>
                  <b>{c.authorName}</b>
                  <span className="muted"> · {title(c.listingId)} · {fmtWhen(c.createdAt)}</span>
                  {c.parentId && <span className="muted"> · reply</span>}
                </span>
                {c.deletedAt ? (
                  <span className="muted">(removed)</span>
                ) : (
                  <span style={{ whiteSpace: "pre-wrap" }}>{c.body}</span>
                )}
                {!c.deletedAt && (
                  <span className="row-actions" style={{ justifyContent: "flex-start" }}>
                    <input
                      style={{ flex: 1, minWidth: 160 }}
                      placeholder="Reply as JJ…"
                      value={reply[c.id] ?? ""}
                      onChange={(e) => setReply({ ...reply, [c.id]: e.target.value })}
                    />
                    <button
                      className="btn ghost"
                      type="button"
                      disabled={!(reply[c.id] ?? "").trim()}
                      onClick={() =>
                        void api
                          .postComment(searchId, {
                            listingId: c.listingId,
                            parentId: c.parentId ?? c.id,
                            body: (reply[c.id] ?? "").trim()
                          })
                          .then(() => {
                            setReply({ ...reply, [c.id]: "" });
                            toast("Reply posted");
                            return reload();
                          })
                      }
                    >
                      Reply
                    </button>
                    <DangerButton
                      onConfirm={() =>
                        void api.deleteComment(searchId, c.id).then(() => {
                          toast("Comment removed");
                          return reload();
                        })
                      }
                    />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>Activity</h2>
        {feed.length === 0 ? (
          <p className="note-line">No activity yet for this search.</p>
        ) : (
          <ul className="feed">
            {feed.map((e) => (
              <li key={e.id}>
                <span className="t">{fmtWhen(e.at)}</span>
                <span>
                  {e.summary}
                  {e.listingId && (
                    <small className="muted"> · {title(e.listingId)}</small>
                  )}
                </span>
                <span className="who">{e.actorRole}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {toastEl}
    </div>
  );
}
