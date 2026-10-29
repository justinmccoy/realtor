import { useCallback, useEffect, useState } from "react";
import {
  LISTING_STATUS_LABELS,
  LISTING_STATUSES,
  districtNumber,
  pricePerSqm,
  visibility,
  type Brief,
  type Listing,
  type ListingStatus,
  type PhotoKind,
  type Search,
  type ShareMode,
  type Source,
  type VisibilityReason
} from "@jj/shared";
import { api, type PhotoWithUrl } from "../api/client";
import { eur, fmtWhen } from "../lib/format";
import { DangerButton, Modal, useToast } from "../components/ui";
import { ListingEditor, type EditorTarget } from "./ListingEditor";

interface SearchCtx {
  search: Search;
  brief: Brief;
  shares: Map<string, ShareMode>;
}

const REASON_LABEL: Record<VisibilityReason, string> = {
  match: "auto ✓",
  shared: "shared",
  hidden: "hidden",
  "no-match": "—",
  draft: "draft"
};

export function Listings({
  searches,
  focusListingId,
  onFocusHandled
}: {
  searches: Search[];
  focusListingId?: string | null;
  onFocusHandled?: () => void;
}) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [contexts, setContexts] = useState<SearchCtx[]>([]);
  const [status, setStatus] = useState<"" | ListingStatus>("");
  const [published, setPublished] = useState<"" | "true" | "false">("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"new" | "price" | "sqm">("new");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [photoTarget, setPhotoTarget] = useState<Listing | null>(null);
  const [shareTarget, setShareTarget] = useState<Listing | null>(null);
  const [toastEl, toast] = useToast();

  const active = searches.filter((s) => s.status === "active");

  const reload = useCallback(async () => {
    const ls = await api.listings({
      status: status || undefined,
      q: q || undefined,
      published: published === "" ? undefined : published === "true",
      sort
    });
    setListings(ls.items);
    setSelected(new Set());
    // Per-search context (brief + overrides) for visibility badges — loaded
    // sequentially to stay friendly to low Lambda concurrency limits.
    const ctxs: SearchCtx[] = [];
    for (const search of active) {
      try {
        const detail = await api.searchDetail(search.id);
        const shares = await api.shares(search.id);
        ctxs.push({
          search,
          brief: detail.brief,
          shares: new Map(shares.items.map((i) => [i.listingId, i.mode]))
        });
      } catch {
        /* badge column shows nothing for this search */
      }
    }
    setContexts(ctxs);
  }, [status, q, published, sort, active.map((s) => s.id).join(",")]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Dashboard click-through: open the editor for the requested listing.
  useEffect(() => {
    if (!focusListingId || !listings.length) return;
    const target = listings.find((l) => l.id === focusListingId);
    if (target) setEditor({ listing: target });
    onFocusHandled?.();
  }, [focusListingId, listings.length]);

  const toggleAll = () =>
    setSelected(
      selected.size === listings.length ? new Set() : new Set(listings.map((l) => l.id))
    );

  async function bulk(op: "publish" | "unpublish" | "delete" | "status", s?: ListingStatus) {
    if (!selected.size) return;
    await api.bulkListings({ ids: [...selected], op, ...(s ? { status: s } : {}) });
    toast(`Bulk ${op} done (${selected.size})`);
    await reload();
  }

  const visibleBadges = (l: Listing) =>
    contexts.map((ctx) => {
      const v = visibility(l, ctx.brief, ctx.search.settings, ctx.shares.get(l.id));
      return { name: ctx.search.clientName, ...v };
    });

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="page-h">
        <h2>Listings · global pool</h2>
        <button className="btn primary" type="button" onClick={() => setEditor({ listing: null })}>
          + Add listing
        </button>
      </div>

      <div className="filters">
        <input
          type="search"
          placeholder="Search title, street, notes…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="inline" value={status} onChange={(e) => setStatus(e.target.value as "" | ListingStatus)}>
          <option value="">All statuses</option>
          {LISTING_STATUSES.map((s) => (
            <option key={s} value={s}>
              {LISTING_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select className="inline" value={published} onChange={(e) => setPublished(e.target.value as "" | "true" | "false")}>
          <option value="">Active + drafts</option>
          <option value="true">Active only</option>
          <option value="false">Drafts only</option>
        </select>
        <select className="inline" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="new">Newest first</option>
          <option value="price">Price, low to high</option>
          <option value="sqm">€/m², low to high</option>
        </select>
      </div>

      {selected.size > 0 && (
        <div className="bulkbar">
          <b>{selected.size} selected</b>
          <button className="btn" type="button" onClick={() => void bulk("publish")}>
            Activate
          </button>
          <button className="btn" type="button" onClick={() => void bulk("unpublish")}>
            Deactivate
          </button>
          <select
            className="inline"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) void bulk("status", e.target.value as ListingStatus);
              e.target.value = "";
            }}
          >
            <option value="">Set status…</option>
            {LISTING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {LISTING_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <select
            className="inline"
            defaultValue=""
            onChange={(e) => {
              const sid = e.target.value;
              e.target.value = "";
              if (!sid) return;
              void (async () => {
                for (const lid of selected) {
                  await api.putShare(sid, lid, "shared");
                }
                toast(`Shared ${selected.size} listing(s)`);
                await reload();
              })();
            }}
          >
            <option value="">Share with…</option>
            {active.map((s) => (
              <option key={s.id} value={s.id}>
                {s.clientName}
              </option>
            ))}
          </select>
          <DangerButton label={`Delete ${selected.size}`} onConfirm={() => void bulk("delete")} />
        </div>
      )}

      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th className="sel">
                <input
                  type="checkbox"
                  checked={selected.size === listings.length && listings.length > 0}
                  onChange={toggleAll}
                />
              </th>
              <th>Listing</th>
              <th>Status</th>
              <th>Price</th>
              <th>Active</th>
              <th>Visible to</th>
              <th>Viewing</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {listings.map((l) => {
              const psqm = pricePerSqm(l.price, l.sqm);
              return (
                <tr key={l.id}>
                  <td className="sel">
                    <input
                      type="checkbox"
                      checked={selected.has(l.id)}
                      onChange={() =>
                        setSelected((cur) => {
                          const next = new Set(cur);
                          if (next.has(l.id)) next.delete(l.id);
                          else next.add(l.id);
                          return next;
                        })
                      }
                    />
                  </td>
                  <td>
                    <b>{l.title}</b>
                    {l.benchmark && <span className="benchtag"> benchmark</span>}
                    {l.topRank > 0 && <span className="rankbadge"> #{l.topRank}</span>}
                    <br />
                    <small className="muted">
                      {districtNumber(l.bezirk)} · {l.ortsteil ?? l.bezirk}
                      {l.kiez ? ` · ${l.kiez}` : ""}
                    </small>
                  </td>
                  <td>
                    <select
                      className="pill pillsel"
                      data-st={l.status}
                      value={l.status}
                      onChange={(e) =>
                        void api
                          .patchListing(l.id, "status", {
                            status: e.target.value as ListingStatus
                          })
                          .then(reload)
                      }
                    >
                      {LISTING_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {LISTING_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="num">
                    {l.price ? eur(l.price) : "—"}
                    {psqm && (
                      <>
                        <br />
                        <small className="muted">{eur(psqm)}/m²</small>
                      </>
                    )}
                  </td>
                  <td>
                    <label className="paidbox">
                      <input
                        type="checkbox"
                        checked={l.published}
                        onChange={(e) =>
                          void api
                            .patchListing(l.id, "publish", {
                              published: e.target.checked
                            })
                            .then(() => {
                              toast(e.target.checked ? "Activated" : "Now a draft");
                              return reload();
                            })
                        }
                      />{" "}
                      {l.published ? "Active" : "Draft"}
                    </label>
                  </td>
                  <td>
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={() => setShareTarget(l)}
                      title="Manage per-client visibility"
                    >
                      {visibleBadges(l)
                        .map((b) => `${b.name}: ${REASON_LABEL[b.reason]}`)
                        .join(" · ") || "—"}
                    </button>
                  </td>
                  <td className="muted">{l.viewingAt ? fmtWhen(l.viewingAt) : "—"}</td>
                  <td>
                    <div className="row-actions">
                      <button className="btn ghost" type="button" onClick={() => setEditor({ listing: l })}>
                        Edit
                      </button>
                      <button className="btn ghost" type="button" onClick={() => setPhotoTarget(l)}>
                        Photos
                      </button>
                      <DangerButton
                        onConfirm={() =>
                          void api.deleteListing(l.id).then(() => {
                            toast("Listing deleted");
                            return reload();
                          })
                        }
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
            {listings.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  No listings match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="note-line">
        Visible to: <b>auto ✓</b> matches the client's brief · <b>shared</b> /{" "}
        <b>hidden</b> are manual overrides · <b>—</b> no match · <b>draft</b>{" "}
        never shown. Click to change.
      </p>

      <Inbox onConvert={(t) => setEditor(t)} toast={toast} />

      {editor && (
        <ListingEditor
          target={editor}
          onClose={() => setEditor(null)}
          onSaved={() => void reload()}
          toast={toast}
        />
      )}
      {photoTarget && (
        <PhotoManager
          listing={photoTarget}
          onClose={() => setPhotoTarget(null)}
          toast={toast}
        />
      )}
      {shareTarget && (
        <ShareManager
          listing={shareTarget}
          contexts={contexts}
          onClose={() => setShareTarget(null)}
          onChanged={() => void reload()}
          toast={toast}
        />
      )}
      {toastEl}
    </section>
  );
}

/** Per-client visibility for one listing: Auto / Share / Hide per search. */
function ShareManager({
  listing,
  contexts,
  onClose,
  onChanged,
  toast
}: {
  listing: Listing;
  contexts: SearchCtx[];
  onClose: () => void;
  onChanged: () => void;
  toast: (m: string) => void;
}) {
  async function set(sid: string, value: "auto" | ShareMode) {
    if (value === "auto") await api.clearShare(sid, listing.id);
    else await api.putShare(sid, listing.id, value);
    toast("Visibility updated");
    onChanged();
  }
  return (
    <Modal title={`Visibility — ${listing.title}`} onClose={onClose}>
      {!listing.published && (
        <p className="err" style={{ margin: 0 }}>
          This listing is a draft — no client can see it until it's Active.
        </p>
      )}
      {contexts.length === 0 && (
        <p className="note-line">No active client searches yet.</p>
      )}
      {contexts.map((ctx) => {
        const share = ctx.shares.get(listing.id);
        const v = visibility(listing, ctx.brief, ctx.search.settings, share);
        const matches = visibility(
          { ...listing, published: true },
          ctx.brief,
          ctx.search.settings,
          undefined
        ).visible;
        return (
          <div className="vbox" key={ctx.search.id}>
            <div className="vbox-h">
              <h4>{ctx.search.clientName}</h4>
              <span className={`rmini2${v.visible ? " ok" : ""}`}>
                {v.visible ? "visible" : "not visible"} · {REASON_LABEL[v.reason]}
              </span>
            </div>
            <p className="note-line" style={{ margin: 0 }}>
              {matches
                ? "Matches this client's brief."
                : "Does not match this client's brief."}
            </p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(["auto", "shared", "hidden"] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className="chip"
                  aria-pressed={(share ?? "auto") === opt}
                  onClick={() => void set(ctx.search.id, opt)}
                >
                  {opt === "auto"
                    ? "Auto (follow brief)"
                    : opt === "shared"
                      ? "Share"
                      : "Hide"}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </Modal>
  );
}

function Inbox({
  onConvert,
  toast
}: {
  onConvert: (t: EditorTarget) => void;
  toast: (m: string) => void;
}) {
  const [sources, setSources] = useState<Source[]>([]);
  const [urls, setUrls] = useState("");

  const reload = useCallback(() => api.inbox().then((r) => setSources(r.items)), []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const pending = sources.filter((s) => s.status !== "done");

  return (
    <section className="panel inbox">
      <div className="inbox-h">
        <h2>Link inbox</h2>
      </div>
      <form
        style={{ display: "flex", flexDirection: "column", gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          const list = urls.split(/\s+/).filter((u) => /^https?:\/\//i.test(u));
          if (!list.length) {
            toast("Paste at least one http(s) link");
            return;
          }
          void api.addInbox(list).then((r) => {
            setUrls("");
            toast(`${r.items.length} link(s) added`);
            return reload();
          });
        }}
      >
        <div className="field">
          <label>Paste listing links, one per line</label>
          <textarea
            value={urls}
            placeholder="https://www.immobilienscout24.de/expose/…"
            onChange={(e) => setUrls(e.target.value)}
          />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn primary" type="submit">
            Add to inbox
          </button>
          <span className="note-line">
            Convert a link into a listing with the button next to it.
          </span>
        </div>
      </form>
      {pending.length > 0 && (
        <ul>
          {pending.map((s) => (
            <li key={s.id}>
              <span className="tag">Pending</span>
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                {s.url}
              </a>
              <span className="row-actions">
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => onConvert({ listing: null, sourceId: s.id, sourceUrl: s.url })}
                >
                  Convert
                </button>
                <DangerButton
                  onConfirm={() => void api.deleteInbox(s.id).then(() => reload())}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PhotoManager({
  listing,
  onClose,
  toast
}: {
  listing: Listing;
  onClose: () => void;
  toast: (m: string) => void;
}) {
  const [photos, setPhotos] = useState<PhotoWithUrl[]>([]);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<PhotoKind>("photo");

  const reload = useCallback(
    () => api.photos(listing.id).then((r) => setPhotos(r.items)),
    [listing.id]
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    let ok = 0;
    try {
      for (const file of [...files]) {
        if (!/^image\/(jpeg|png|webp)$/.test(file.type)) continue;
        const presigned = await api.presign(listing.id, kind, file.type);
        const put = await fetch(presigned.uploadUrl, {
          method: "PUT",
          headers: presigned.headers,
          body: file
        });
        if (!put.ok) throw new Error(`Upload failed (${put.status})`);
        await api.confirmPhoto(listing.id, presigned.photoId);
        ok++;
      }
      toast(`Added ${ok} ${kind === "floorplan" ? "floor plan" : "photo"}${ok === 1 ? "" : "s"}`);
      await reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function move(id: string, dir: -1 | 1, ofKind: PhotoKind) {
    const list = photos.filter((p) => p.kind === ofKind).map((p) => p.id);
    const i = list.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    await api.reorderPhotos(listing.id, ofKind, list);
    await reload();
  }

  const grid = (ofKind: PhotoKind) => {
    const items = photos.filter((p) => p.kind === ofKind);
    if (!items.length) return <p className="note-line">None yet.</p>;
    return (
      <div className="ph-grid">
        {items.map((p, i) => (
          <figure key={p.id}>
            <img src={p.url} alt="" />
            <div className="ops">
              <button className="btn ghost" type="button" disabled={i === 0} onClick={() => void move(p.id, -1, ofKind)}>
                ←
              </button>
              <button
                className="btn ghost"
                type="button"
                disabled={i === items.length - 1}
                onClick={() => void move(p.id, 1, ofKind)}
              >
                →
              </button>
              <DangerButton
                onConfirm={() =>
                  void api.deletePhoto(listing.id, p.id).then(() => {
                    toast("Photo deleted");
                    return reload();
                  })
                }
              />
            </div>
          </figure>
        ))}
      </div>
    );
  };

  return (
    <Modal title={`Photos — ${listing.title}`} onClose={onClose}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select className="inline" value={kind} onChange={(e) => setKind(e.target.value as PhotoKind)}>
          <option value="photo">Photos</option>
          <option value="floorplan">Floor plan</option>
        </select>
        <label className="btn">
          {busy ? "Uploading…" : "+ Upload images"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            hidden
            disabled={busy}
            onChange={(e) => {
              void upload(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        <span className="note-line">JPEG/PNG/WebP, max 8 MB each.</span>
      </div>
      <h4 style={{ margin: "8px 0 0" }}>Photos</h4>
      {grid("photo")}
      <h4 style={{ margin: "8px 0 0" }}>Floor plans</h4>
      {grid("floorplan")}
    </Modal>
  );
}
