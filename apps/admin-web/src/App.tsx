import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Search } from "@jj/shared";
import { api, type SearchDetail } from "./api/client";
import { useAuth } from "./auth/AuthContext";
import { Field, Modal, useToast } from "./components/ui";
import { configOk } from "./config";
import { Audit } from "./pages/Audit";
import { Clients } from "./pages/Clients";
import { Dashboard } from "./pages/Dashboard";
import { Engagement } from "./pages/Engagement";
import { Hours } from "./pages/Hours";
import { Listings } from "./pages/Listings";
import { Login } from "./pages/Login";
import { SearchOverview } from "./pages/SearchOverview";

type Page =
  | "dashboard"
  | "clients"
  | "overview"
  | "listings"
  | "hours"
  | "engagement"
  | "audit";

export default function App() {
  const auth = useAuth();
  const [searches, setSearches] = useState<Search[]>([]);
  const [searchId, setSearchId] = useState<string | null>(
    localStorage.getItem("jj-admin-search") || null
  );
  const [detail, setDetail] = useState<SearchDetail | null>(null);
  const PAGES: Page[] = ["dashboard", "clients", "overview", "listings", "hours", "engagement", "audit"];
  const [page, setPageState] = useState<Page>(() => {
    const h = location.hash.replace("#", "") as Page;
    return PAGES.includes(h) ? h : "dashboard";
  });
  const setPage = (p: Page) => {
    setPageState(p);
    try {
      history.replaceState(null, "", `#${p}`);
    } catch {
      /* ignore */
    }
  };
  const [focusListingId, setFocusListingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [toastEl, toast] = useToast();

  const loadSearches = useCallback(async () => {
    const r = await api.searches();
    setSearches(r.items);
    const first = r.items[0];
    setSearchId((cur) => (cur && r.items.some((s) => s.id === cur) ? cur : (first?.id ?? null)));
  }, []);

  useEffect(() => {
    if (auth.status === "signedIn") void loadSearches();
  }, [auth.status, loadSearches]);

  const loadDetail = useCallback(async () => {
    if (!searchId) {
      setDetail(null);
      return;
    }
    localStorage.setItem("jj-admin-search", searchId);
    try {
      setDetail(await api.searchDetail(searchId));
    } catch {
      // Search was deleted (or access changed): fall back until the search
      // list refresh picks a valid one.
      setDetail(null);
    }
  }, [searchId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  if (!configOk) {
    return (
      <div className="fatal">
        Missing configuration: set VITE_ADMIN_POOL_ID and VITE_ADMIN_CLIENT_ID.
      </div>
    );
  }
  if (auth.status === "loading") return <div className="loading">Loading…</div>;
  if (auth.status === "signedOut") return <Login />;

  const current = searches.find((s) => s.id === searchId);
  const perSearchPages: { key: Page; label: string }[] = [
    { key: "overview", label: "Search" },
    { key: "hours", label: "Hours" },
    { key: "engagement", label: "Engagement" }
  ];

  return (
    <div className="wrap">
      <header>
        <div>
          <div className="eyebrow">Admin</div>
          <h1>
            Berlin <span className="u">Calling</span>
          </h1>
        </div>
        <div className="head-actions">
          {current && (
            <button
              className="plate"
              type="button"
              title="Open this search's settings"
              style={{ cursor: "pointer", background: "none" }}
              onClick={() => setPage("overview")}
            >
              <span className="pn">⌂</span>
              <span className="pb">
                {current.clientName}
                {current.status === "archived" ? " (archived)" : ""}
              </span>
            </button>
          )}
          <span className="note-line">{auth.name || auth.email}</span>
          <button
            className="btn ghost"
            type="button"
            onClick={() => {
              auth.signOut();
              try {
                history.replaceState(null, "", location.pathname + location.search);
              } catch {
                /* ignore */
              }
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <nav className="tabs admin-nav" role="tablist">
        <button
          className="tab"
          role="tab"
          aria-selected={page === "dashboard"}
          type="button"
          onClick={() => setPage("dashboard")}
        >
          Dashboard
        </button>
        <button
          className="tab"
          role="tab"
          aria-selected={page === "clients"}
          type="button"
          onClick={() => setPage("clients")}
        >
          Clients
        </button>
        <button
          className="tab"
          role="tab"
          aria-selected={page === "listings"}
          type="button"
          onClick={() => setPage("listings")}
        >
          Listings
        </button>
        {current &&
          perSearchPages.map((p) => (
            <button
              key={p.key}
              className="tab"
              role="tab"
              aria-selected={page === p.key}
              type="button"
              onClick={() => setPage(p.key)}
            >
              {p.label}
            </button>
          ))}
        <button
          className="tab"
          role="tab"
          aria-selected={page === "audit"}
          type="button"
          onClick={() => setPage("audit")}
        >
          Audit
        </button>
      </nav>

      {page === "dashboard" && (
        <Dashboard
          searches={searches}
          onOpenSearch={(sid, target) => {
            setSearchId(sid);
            setPage(target ?? "overview");
          }}
          onOpenListing={(lid) => {
            setFocusListingId(lid);
            setPage("listings");
          }}
        />
      )}
      {page === "clients" && (
        <Clients searches={searches} onChanged={() => void loadSearches()} />
      )}
      {page === "overview" && (
        <div className="page-h">
          <div className="filters">
            <label className="note-line" htmlFor="search-select">
              Working on
            </label>
            <select
              id="search-select"
              className="inline"
              value={searchId ?? ""}
              onChange={(e) => setSearchId(e.target.value || null)}
            >
              {searches.length === 0 && <option value="">No searches yet</option>}
              {searches.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.clientName}
                  {s.status === "archived" ? " (archived)" : ""}
                </option>
              ))}
            </select>
          </div>
          <button className="btn primary" type="button" onClick={() => setCreating(true)}>
            + New search
          </button>
        </div>
      )}
      {page === "overview" &&
        (detail ? (
          <SearchOverview
            detail={detail}
            onChanged={() => void loadSearches().then(() => loadDetail())}
            onDeleted={() => {
              // The shown search is gone: clear the sticky selection, land on
              // the dashboard, and let the refreshed list pick what's next.
              localStorage.removeItem("jj-admin-search");
              setDetail(null);
              setSearchId(null);
              setPage("dashboard");
              void loadSearches();
            }}
            toast={toast}
          />
        ) : (
          <div className="loading">Pick or create a search.</div>
        ))}
      {page === "listings" && (
        <Listings
          searches={searches}
          focusListingId={focusListingId}
          onFocusHandled={() => setFocusListingId(null)}
        />
      )}
      {page === "hours" && current && <Hours search={current} />}
      {page === "engagement" && searchId && <Engagement searchId={searchId} />}
      {page === "audit" && <Audit />}

      {creating && (
        <NewSearch
          onClose={() => setCreating(false)}
          onCreated={(sid) => {
            setCreating(false);
            void loadSearches().then(() => {
              setSearchId(sid);
              setPage("overview");
            });
            toast("Search created");
          }}
        />
      )}
      {toastEl}
    </div>
  );
}

function NewSearch({
  onClose,
  onCreated
}: {
  onClose: () => void;
  onCreated: (sid: string) => void;
}) {
  const [name, setName] = useState("");
  const [err, setErr] = useState("");

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      const s = await api.createSearch({ clientName: name.trim() });
      onCreated(s.id);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Couldn't create the search");
    }
  }

  return (
    <Modal title="New client search" onClose={onClose}>
      <form onSubmit={create} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Buyer name" hint="Berlin cost defaults (6% + 2% + 3.57%) are applied; adjust in Settings.">
          <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </Field>
        {err && <p className="err">{err}</p>}
        <div className="sheet-f">
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" type="submit">
            Create search
          </button>
        </div>
      </form>
    </Modal>
  );
}
