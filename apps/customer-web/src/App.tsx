import { useEffect, useMemo, useState } from "react";
import {
  LISTING_STATUS_LABELS,
  LISTING_STATUSES,
  type ListingStatus
} from "@jj/shared";
import { api, type SearchLite } from "./api/client";
import { useAuth } from "./auth/AuthContext";
import { BriefPanel } from "./components/Brief";
import { CommentThread } from "./components/Comments";
import { HoursPanel } from "./components/HoursPanel";
import { ListingCard } from "./components/ListingCard";
import { Summary } from "./components/Summary";
import { Top5 } from "./components/Top5";
import { configOk } from "./config";
import { allMapUrl, sortCards } from "./lib/fit";
import { Login } from "./pages/Login";
import { initTracking, track } from "./tracking";
import { useSearchData } from "./useSearchData";

type Filter = "all" | ListingStatus;
type Sort = "new" | "score" | "price" | "sqm";
type Tab = "listings" | "hours";

export default function App() {
  const auth = useAuth();
  const [searches, setSearches] = useState<SearchLite[] | null>(null);
  const [searchId, setSearchId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(
    location.hash === "#hours" ? "hours" : "listings"
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("new");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");

  const { data, error, refreshRatings, refreshComments } = useSearchData(searchId);

  useEffect(() => {
    if (auth.status !== "signedIn") return;
    api
      .mySearches()
      .then((r) => {
        setSearches(r.items);
        const first = r.items[0];
        if (first) setSearchId(first.id);
      })
      .catch((e) =>
        setLoadError(e instanceof Error ? e.message : "Couldn't load your searches")
      );
  }, [auth.status]);

  useEffect(() => {
    if (searchId) initTracking(searchId);
  }, [searchId]);

  useEffect(() => {
    if (tab === "hours") track("hours_viewed");
    try {
      history.replaceState(null, "", `#${tab}`);
    } catch {
      /* ignore */
    }
  }, [tab]);

  const avgScore = useMemo(() => {
    const map = new Map<string, { sum: number; n: number }>();
    for (const r of data?.ratings ?? []) {
      const cur = map.get(r.listingId) ?? { sum: 0, n: 0 };
      map.set(r.listingId, { sum: cur.sum + r.score, n: cur.n + 1 });
    }
    return (id: string) => {
      const v = map.get(id);
      return v ? v.sum / v.n : 0;
    };
  }, [data?.ratings]);

  if (!configOk) {
    return (
      <div className="fatal">
        Missing configuration: set VITE_CUSTOMER_POOL_ID and VITE_CUSTOMER_CLIENT_ID.
      </div>
    );
  }
  if (auth.status === "loading") return <div className="loading">Loading…</div>;
  if (auth.status === "signedOut") return <Login />;

  if (loadError) return <div className="fatal">{loadError}</div>;
  if (!searches) return <div className="loading">Loading your search…</div>;

  if (!searches.length) {
    return (
      <div className="wrap">
        <Header clientName={null} />
        <div className="empty">
          <h3>No search assigned yet</h3>
          <p>
            Your account is set up, but no apartment search has been shared with
            you yet. You'll see the board here as soon as JJ adds you.
          </p>
        </div>
      </div>
    );
  }

  if (error) return <div className="fatal">{error}</div>;
  if (!data || !searchId) return <div className="loading">Loading the board…</div>;

  const listings = data.listings;
  const benchmark = listings.find((l) => l.benchmark);
  const counts: Record<string, number> = { all: listings.length };
  for (const s of LISTING_STATUSES) {
    counts[s] = listings.filter((l) => l.status === s).length;
  }
  const filtered = listings.filter((l) => filter === "all" || l.status === filter);
  const cards = sortCards(filtered, sort, avgScore);
  const mapAll = allMapUrl(listings);
  const allOpen = listings.length > 0 && listings.every((l) => open.has(l.id));
  const photosFor = (id: string) =>
    data.photos
      .filter((p) => p.listingId === id)
      .sort((a, b) => a.sortOrder - b.sortOrder);

  const goto = (id: string) => {
    setOpen((o) => new Set(o).add(id));
    requestAnimationFrame(() => {
      document.getElementById(`card-${id}`)?.scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start"
      });
    });
  };

  return (
    <div className="wrap">
      <Header clientName={data.clientName} />

      {searches.length > 1 && (
        <div className="picker">
          {searches.map((s) => (
            <button
              key={s.id}
              className="chip"
              aria-pressed={s.id === searchId}
              type="button"
              onClick={() => setSearchId(s.id)}
            >
              {s.clientName}
            </button>
          ))}
        </div>
      )}

      <nav className="tabs" role="tablist">
        <button
          className="tab"
          role="tab"
          aria-selected={tab === "listings"}
          type="button"
          onClick={() => setTab("listings")}
        >
          Listings <span className="c">{listings.length || ""}</span>
        </button>
        <button
          className="tab"
          role="tab"
          aria-selected={tab === "hours"}
          type="button"
          onClick={() => setTab("hours")}
        >
          Hours
        </button>
      </nav>

      {tab === "listings" ? (
        <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <BriefPanel brief={data.brief} settings={data.settings} />
          <Summary listings={listings} />
          <Top5 listings={listings} settings={data.settings} onGoto={goto} />

          <div className="toolbar">
            <div className="chips">
              {(["all", ...LISTING_STATUSES] as Filter[])
                .filter((k) => k === "all" || counts[k])
                .map((k) => (
                  <button
                    key={k}
                    className="chip"
                    type="button"
                    aria-pressed={filter === k}
                    onClick={() => setFilter(k)}
                  >
                    {k === "all" ? "All" : LISTING_STATUS_LABELS[k as ListingStatus]}{" "}
                    <span className="num">{counts[k]}</span>
                  </button>
                ))}
            </div>
            <div className="tool-right">
              {mapAll && (
                <a
                  className="btn"
                  href={mapAll}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => track("map_clicked")}
                >
                  All on Google Maps ↗
                </a>
              )}
              <button
                className="btn"
                type="button"
                onClick={() =>
                  setOpen(allOpen ? new Set() : new Set(listings.map((l) => l.id)))
                }
              >
                {allOpen ? "Collapse all" : "Expand all"}
              </button>
              <label className="note-line" htmlFor="sort">
                Sort
              </label>
              <select
                className="inline"
                id="sort"
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
              >
                <option value="new">Newest first</option>
                <option value="score">Best rated</option>
                <option value="price">Price, low to high</option>
                <option value="sqm">€/m², low to high</option>
              </select>
            </div>
          </div>

          {cards.length === 0 ? (
            <div className="empty">
              <h3>No listings yet</h3>
              <p>No apartments have been added yet. They'll appear here as soon as they are.</p>
            </div>
          ) : (
            <div className="grid">
              {cards.map((l) => (
                <ListingCard
                  key={l.id}
                  listing={l}
                  benchmark={benchmark}
                  brief={data.brief}
                  settings={data.settings}
                  photos={photosFor(l.id)}
                  ratings={data.ratings}
                  comments={data.comments}
                  searchId={searchId}
                  canRate={data.role === "client"}
                  expanded={open.has(l.id)}
                  onToggle={() =>
                    setOpen((o) => {
                      const next = new Set(o);
                      if (next.has(l.id)) next.delete(l.id);
                      else next.add(l.id);
                      return next;
                    })
                  }
                  onZoom={setZoom}
                  onRatingsChanged={() => void refreshRatings()}
                  onCommentsChanged={() => void refreshComments()}
                />
              ))}
            </div>
          )}

          <section className="panel discuss">
            <div className="inbox-h">
              <h2>Discussion</h2>
            </div>
            <p className="note-line" style={{ margin: 0 }}>
              Questions, wishes and reactions about the search as a whole. To talk
              about one apartment, use the comments on its card.
            </p>
            <CommentThread
              searchId={searchId}
              listingId={null}
              comments={data.comments}
              onChanged={() => void refreshComments()}
              placeholder="Write to JJ about the search…"
            />
          </section>
        </section>
      ) : (
        <section className="hours-layout" style={{ gridTemplateColumns: "1fr" }}>
          <HoursPanel hours={data.hours} settings={data.settings} listings={listings} />
        </section>
      )}

      {zoom && (
        <div className="modal lightbox" onClick={() => setZoom(null)}>
          <div style={{ width: "100%", maxWidth: 1100, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ textAlign: "right" }}>
              <button className="btn" type="button" onClick={() => setZoom(null)}>
                Close
              </button>
            </div>
            <img src={zoom} alt="" />
          </div>
        </div>
      )}
    </div>
  );
}

function Header({ clientName }: { clientName: string | null }) {
  const auth = useAuth();
  return (
    <header>
      <div>
        <div className="eyebrow">
          {clientName ? `Apartment search for ${clientName}` : "Apartment search"}
        </div>
        <h1>
          Berlin <span className="u">Calling</span>
        </h1>
      </div>
      <div className="head-actions">
        <span className="note-line">{auth.name || auth.email}</span>
        <button className="btn ghost" type="button" onClick={auth.signOut}>
          Sign out
        </button>
      </div>
    </header>
  );
}
