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
  onOpenSearch
}: {
  searches: Search[];
  onOpenSearch: (sid: string) => void;
}) {
  const [feed, setFeed] = useState<ActivityRecord[]>([]);
  const [viewings, setViewings] = useState<Listing[]>([]);
  const [stats, setStats] = useState<SearchStats[]>([]);

  useEffect(() => {
    void api.activity({ limit: 25 }).then((r) => setFeed(r.items));
    void api.viewings(14).then((r) => setViewings(r.items));
  }, []);

  useEffect(() => {
    const active = searches.filter((s) => s.status === "active").slice(0, 20);
    void Promise.all(
      active.map(async (search) => {
        const [hours, activity] = await Promise.all([
          api.hours(search.id, { paid: false }),
          api.activity({ searchId: search.id, limit: 1 })
        ]);
        return {
          search,
          openMinutes: hours.items.reduce((a, h) => a + h.minutes, 0),
          lastActivity: activity.items[0]?.at ?? null
        } satisfies SearchStats;
      })
    ).then(setStats);
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
                  {l.title}
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
                <span>{e.summary}</span>
                <span className="who">{e.actorRole}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
