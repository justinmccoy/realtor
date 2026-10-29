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
import { HoursPanel } from "./components/HoursPanel";
import { InvitePanel } from "./components/InvitePanel";
import { ListingCard } from "./components/ListingCard";
import { Summary } from "./components/Summary";
import { configOk } from "./config";
import { sortCards } from "./lib/fit";
import { ListingDetail } from "./pages/ListingDetail";
import { Login } from "./pages/Login";
import { initTracking, track } from "./tracking";
import { useSearchData } from "./useSearchData";

type Filter = "all" | ListingStatus;
type Sort = "new" | "score" | "price" | "sqm";

/** `#listing-<id>` is the detail route; anything else is the board. */
const listingFromHash = (): string | null =>
  location.hash.match(/^#listing-(.+)$/)?.[1] ?? null;

export default function App() {
  const auth = useAuth();
  const [searches, setSearches] = useState<SearchLite[] | null>(null);
  const [searchId, setSearchId] = useState<string | null>(null);
  const [billingOpen, setBillingOpen] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
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
  const [detailId, setDetailId] = useState<string | null>(listingFromHash);
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

  // Browser back/forward and pasted deep links drive the detail route.
  useEffect(() => {
    const onHash = () => setDetailId(listingFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const openListing = (id: string) => {
    track("listing_expanded", id);
    location.hash = `listing-${id}`; // fires hashchange → setDetailId
  };

  const closeListing = () => {
    const id = detailId;
    try {
      history.pushState(null, "", location.pathname + location.search);
    } catch {
      /* ignore */
    }
    setDetailId(null);
    if (id) {
      requestAnimationFrame(() => {
        document.getElementById(`card-${id}`)?.scrollIntoView({ block: "center" });
      });
    }
  };

  // Detail page always starts at the top; the board scrolls back to the tile.
  useEffect(() => {
    if (detailId) window.scrollTo(0, 0);
  }, [detailId]);

  useEffect(() => {
    if (!billingOpen) return;
    track("hours_viewed");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBillingOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [billingOpen]);

  useEffect(() => {
    if (!briefOpen) return;
    track("brief_viewed");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBriefOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [briefOpen]);

  useEffect(() => {
    if (!inviteOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setInviteOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inviteOpen]);

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
  const photosFor = (id: string) =>
    data.photos
      .filter((p) => p.listingId === id)
      .sort((a, b) => a.sortOrder - b.sortOrder);

  const detail = detailId ? listings.find((l) => l.id === detailId) : undefined;

  return (
    <div className="wrap">
      <Header
        clientName={data.clientName}
        onOpenBrief={() => setBriefOpen(true)}
        onOpenInvite={() => setInviteOpen(true)}
        onOpenBilling={() => setBillingOpen(true)}
      />

      {detail ? (
        <ListingDetail
          key={detail.id}
          listing={detail}
          benchmark={benchmark}
          brief={data.brief}
          settings={data.settings}
          photos={photosFor(detail.id)}
          ratings={data.ratings}
          comments={data.comments}
          searchId={searchId}
          canRate={data.role === "client"}
          isNew={newIds.has(detail.id)}
          onBack={closeListing}
          onZoom={(urls, idx) => setZoom({ urls, idx })}
          onRatingsChanged={() => void refreshRatings()}
          onCommentsChanged={() => void refreshComments()}
        />
      ) : (
        <>
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

          <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Summary listings={listings} />

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
                    photos={photosFor(l.id)}
                    isNew={newIds.has(l.id)}
                    onOpen={() => openListing(l.id)}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {briefOpen && (
        <div
          className="modal"
          onClick={(e) => {
            if (e.target === e.currentTarget) setBriefOpen(false);
          }}
        >
          <div
            className="sheet"
            style={{ maxWidth: 760 }}
            role="dialog"
            aria-modal="true"
            aria-label="Search requirements"
          >
            <div className="sheet-h">
              <h2>Search requirements</h2>
              <button className="btn" type="button" onClick={() => setBriefOpen(false)}>
                Close
              </button>
            </div>
            <BriefPanel brief={data.brief} settings={data.settings} />
          </div>
        </div>
      )}

      {inviteOpen && (
        <div
          className="modal"
          onClick={(e) => {
            if (e.target === e.currentTarget) setInviteOpen(false);
          }}
        >
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Invite someone to this search"
          >
            <div className="sheet-h">
              <h2>Share this search</h2>
              <button className="btn" type="button" onClick={() => setInviteOpen(false)}>
                Close
              </button>
            </div>
            <InvitePanel
              key={searchId}
              searchId={searchId}
              myEmail={auth.email}
              canInvite={data.role === "client"}
            />
          </div>
        </div>
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
  onOpenBrief,
  onOpenInvite,
  onOpenBilling
}: {
  clientName: string | null;
  onOpenBrief?: () => void;
  onOpenInvite?: () => void;
  onOpenBilling?: () => void;
}) {
  const items = [
    ...(onOpenBrief ? [{ label: "Search requirements", onClick: onOpenBrief }] : []),
    ...(onOpenInvite ? [{ label: "Invite someone…", onClick: onOpenInvite }] : []),
    ...(onOpenBilling ? [{ label: "Billing", onClick: onOpenBilling }] : [])
  ];
  const auth = useAuth();
  return (
    <header>
      <div>
        <div className="eyebrow">
          {clientName ? `Apartment search for ${clientName}` : "Apartment search"}
        </div>
        <h1>
          Genau <span className="u">Here</span>
        </h1>
      </div>
      <div className="head-actions">
        <UserMenu
          name={auth.name}
          email={auth.email}
          items={items}
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
