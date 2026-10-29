import { useEffect, useState } from "react";
import type { ActivityRecord, Listing, Search } from "@jj/shared";
import { api } from "../api/client";
import { eur, fmtWhen, hm } from "../lib/format";

interface SearchStats {
  search: Search;
  openMinutes: number;
  lastActivity: string | null;
}

export function Dashboard({
  searches,
  onOpenSearch,
  onOpenListing
}: {
  searches: Search[];
  onOpenSearch: (sid: string, page?: "overview" | "engagement") => void;
  onOpenListing: (listingId: string) => void;
}) {
  const [feed, setFeed] = useState<ActivityRecord[]>([]);
  const [viewings, setViewings] = useState<Listing[]>([]);
  const [stats, setStats] = useState<SearchStats[]>([]);

  useEffect(() => {
    void api.activity({ limit: 25 }).then((r) => setFeed(r.items));
    void api.viewings(14).then((r) => setViewings(r.items));
  }, []);

  useEffect(() => {
    // Two aggregate calls instead of 2 per search — kinder to Lambda
    // concurrency limits and much faster.
    const active = searches.filter((s) => s.status === "active").slice(0, 50);
    const ids = active.map((s) => s.id);
    void Promise.all([
      api.hoursSummary(ids),
      api.activitySummary({ searchIds: ids })
    ]).then(([hours, activity]) => {
      const open = new Map(hours.items.map((h) => [h.searchId, h.openMinutes]));
      const last = new Map(
        activity.searches.map((a) => [a.searchId, a.lastActivityAt])
      );
      setStats(
        active.map((search) => ({
          search,
          openMinutes: open.get(search.id) ?? 0,
          lastActivity: last.get(search.id) ?? null
        }))
      );
    });
  }, [searches]);

  const inactive = (iso: string | null) =>
    !iso || Date.now() - new Date(iso).getTime() > 7 * 86_400_000;

  return (
    <div className="dash-grid">
      <section className="panel">
        <h2>Clients</h2>
        {stats.length === 0 && <p className="note-line">No active searches.</p>}
        {stats.map(({ search, openMinutes, lastActivity }) => (
          <div className="vbox" key={search.id}>
            <div className="vbox-h">
              <h4>{search.clientName}</h4>
              <span className="row-actions">
                {inactive(lastActivity) && (
                  <span className="rmini2">quiet {lastActivity ? "7+ days" : "— never active"}</span>
                )}
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => onOpenSearch(search.id)}
                >
                  Open →
                </button>
              </span>
            </div>
            <div className="glance">
              <span>
                <b>{hm(openMinutes)}</b> outstanding
                {search.settings.rate > 0 &&
                  ` · ${eur((openMinutes / 60) * search.settings.rate)}`}
              </span>
              <small className="muted">
                {lastActivity
                  ? `last client activity ${fmtWhen(lastActivity)}`
                  : "no client activity yet"}
              </small>
            </div>
          </div>
        ))}
      </section>

      <section className="panel">
        <h2>Upcoming viewings</h2>
        {viewings.length === 0 ? (
          <p className="note-line">Nothing booked in the next 14 days.</p>
        ) : (
          <ul className="feed">
            {viewings.map((l) => (
              <li key={l.id}>
                <span className="t">{l.viewingAt ? fmtWhen(l.viewingAt) : ""}</span>
                <span>
                  <button
                    type="button"
                    className="t5title"
                    style={{ fontSize: 15 }}
                    onClick={() => onOpenListing(l.id)}
                  >
                    {l.title}
                  </button>
                  <small className="muted"> · {l.bezirk}</small>
                </span>
                <span className="who">{l.price ? eur(l.price) : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>Recent activity</h2>
        {feed.length === 0 ? (
          <p className="note-line">
            Client visits, ratings, comments and admin changes appear here.
          </p>
        ) : (
          <ul className="feed">
            {feed.map((e) => (
              <li key={e.id}>
                <span className="t">{fmtWhen(e.at)}</span>
                <span>
                  {e.searchId ? (
                    <button
                      type="button"
                      className="t5title"
                      style={{ fontSize: 15 }}
                      onClick={() => onOpenSearch(e.searchId!, "engagement")}
                    >
                      {e.summary}
                    </button>
                  ) : (
                    e.summary
                  )}
                </span>
                <span className="who">{e.actorRole}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
