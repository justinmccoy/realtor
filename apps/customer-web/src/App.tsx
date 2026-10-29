import { useEffect, useMemo, useState } from "react";
import {
  LISTING_STATUS_LABELS,
  LISTING_STATUSES,
  type ListingStatus
} from "@jj/shared";
import { api, type SearchLite } from "./api/client";
import { useAuth } from "./auth/AuthContext";
import { changePassword } from "./auth/cognito";
import { UserMenu } from "./components/UserMenu";
import { BriefPanel } from "./components/Brief";
import { SkeletonBoard } from "./components/Skeleton";
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

export default function App() {
  const auth = useAuth();
  const [searches, setSearches] = useState<SearchLite[] | null>(null);
  const [searchId, setSearchId] = useState<string | null>(null);
  // Legacy #billing/#hours links open the popup once, then the hash clears.
  const [billingOpen, setBillingOpen] = useState<boolean>(
    location.hash === "#billing" || location.hash === "#hours"
  );
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSortState] = useState<Sort>(
    () => (localStorage.getItem("jj-sort") as Sort) || "new"
  );
  const setSort = (v: Sort) => {
    setSortState(v);
    try {
      localStorage.setItem("jj-sort", v);
    } catch {
      /* private mode */
    }
  };
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState<{ urls: string[]; idx: number } | null>(null);
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

  // Deep link: #listing-<id> expands and scrolls to that card once loaded.
  useEffect(() => {
    const m = location.hash.match(/^#listing-(.+)$/);
    if (!m || !data) return;
    const id = m[1]!;
    if (data.listings.some((l) => l.id === id)) {
      setOpen((o) => new Set(o).add(id));
      requestAnimationFrame(() => {
        document.getElementById(`card-${id}`)?.scrollIntoView({ block: "start" });
      });
    }
  }, [data?.listings.length]);

  useEffect(() => {
    if (!billingOpen) return;
    track("hours_viewed");
    // Clear a legacy #billing/#hours hash; Esc closes the popup.
    if (/^#(billing|hours)$/.test(location.hash)) {
      try {
        history.replaceState(null, "", location.pathname + location.search);
      } catch {
        /* ignore */
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBillingOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [billingOpen]);

  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoom(null);
      if (e.key === "ArrowRight")
        setZoom((z) => z && { ...z, idx: (z.idx + 1) % z.urls.length });
      if (e.key === "ArrowLeft")
        setZoom((z) => z && { ...z, idx: (z.idx - 1 + z.urls.length) % z.urls.length });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom !== null]);

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
  if (!searches) return <SkeletonBoard />;

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
  if (!data || !searchId) return <SkeletonBoard />;

  const listings = data.listings;
  const newIds = new Set(
    data.prevSeenAt
      ? listings.filter((l) => l.createdAt > data.prevSeenAt!).map((l) => l.id)
      : []
  );
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
    try {
      history.replaceState(null, "", `#listing-${id}`);
    } catch {
      /* ignore */
    }
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
      <Header clientName={data.clientName} onOpenBilling={() => setBillingOpen(true)} />

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
        <button className="tab" role="tab" aria-selected type="button">
          Listings <span className="c">{listings.length || ""}</span>
        </button>
      </nav>

      {(
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

          {newIds.size > 0 && (
            <p className="note-line" style={{ margin: 0 }}>
              <span className="newtag">NEW</span> {newIds.size} apartment
              {newIds.size > 1 ? "s" : ""} added since your last visit.
            </p>
          )}
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
                  isNew={newIds.has(l.id)}
                  expanded={open.has(l.id)}
                  onToggle={() =>
                    setOpen((o) => {
                      const next = new Set(o);
                      if (next.has(l.id)) next.delete(l.id);
                      else next.add(l.id);
                      return next;
                    })
                  }
                  onZoom={(urls, idx) => setZoom({ urls, idx })}
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
      )}

      {billingOpen && (
        <div
          className="modal"
          onClick={(e) => {
            if (e.target === e.currentTarget) setBillingOpen(false);
          }}
        >
          <div
            className="sheet"
            style={{ maxWidth: 880, padding: 0, border: "none", background: "none" }}
          >
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
              <button className="btn" type="button" onClick={() => setBillingOpen(false)}>
                Close
              </button>
            </div>
            <HoursPanel hours={data.hours} settings={data.settings} listings={listings} />
          </div>
        </div>
      )}

      {zoom && (
        <div className="modal lightbox" onClick={() => setZoom(null)}>
          <div
            style={{ width: "100%", maxWidth: 1100, display: "flex", flexDirection: "column", gap: 10 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="note-line num">
                {zoom.idx + 1} / {zoom.urls.length}
              </span>
              <button className="btn" type="button" onClick={() => setZoom(null)}>
                Close
              </button>
            </div>
            <div style={{ position: "relative" }}>
              <img src={zoom.urls[zoom.idx]} alt="" />
              {zoom.urls.length > 1 && (
                <>
                  <button
                    className="nav l"
                    type="button"
                    aria-label="Previous photo"
                    style={{ position: "absolute", top: "50%", left: 10 }}
                    onClick={() =>
                      setZoom({ ...zoom, idx: (zoom.idx - 1 + zoom.urls.length) % zoom.urls.length })
                    }
                  >
                    ‹
                  </button>
                  <button
                    className="nav r"
                    type="button"
                    aria-label="Next photo"
                    style={{ position: "absolute", top: "50%", right: 10 }}
                    onClick={() => setZoom({ ...zoom, idx: (zoom.idx + 1) % zoom.urls.length })}
                  >
                    ›
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Header({
  clientName,
  onOpenBilling
}: {
  clientName: string | null;
  onOpenBilling?: () => void;
}) {
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
        <UserMenu
          name={auth.name}
          email={auth.email}
          items={onOpenBilling ? [{ label: "Billing", onClick: onOpenBilling }] : []}
          changePassword={changePassword}
          onSignOut={() => {
            auth.signOut();
            try {
              history.replaceState(null, "", location.pathname + location.search);
            } catch {
              /* ignore */
            }
          }}
        />
      </div>
    </header>
  );
}
