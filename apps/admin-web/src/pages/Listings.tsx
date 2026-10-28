import { useCallback, useEffect, useState } from "react";
import {
  LISTING_STATUS_LABELS,
  LISTING_STATUSES,
  districtNumber,
  pricePerSqm,
  type Listing,
  type ListingStatus,
  type PhotoKind
} from "@jj/shared";
import { api, type PhotoWithUrl } from "../api/client";
import { eur, fmtWhen } from "../lib/format";
import { DangerButton, Modal, useToast } from "../components/ui";
import { ListingEditor, type EditorTarget } from "./ListingEditor";

export function Listings({ searchId }: { searchId: string }) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [photos, setPhotos] = useState<PhotoWithUrl[]>([]);
  const [status, setStatus] = useState<"" | ListingStatus>("");
  const [published, setPublished] = useState<"" | "true" | "false">("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"new" | "price" | "sqm">("new");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [photoTarget, setPhotoTarget] = useState<Listing | null>(null);
  const [toastEl, toast] = useToast();

  const reload = useCallback(async () => {
    const [ls, ph] = await Promise.all([
      api.listings(searchId, {
        status: status || undefined,
        q: q || undefined,
        published: published === "" ? undefined : published === "true",
        sort
      }),
      api.photos(searchId)
    ]);
    setListings(ls.items);
    setPhotos(ph.items);
    setSelected(new Set());
  }, [searchId, status, q, published, sort]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const toggleAll = () =>
    setSelected(
      selected.size === listings.length ? new Set() : new Set(listings.map((l) => l.id))
    );

  async function bulk(op: "publish" | "unpublish" | "delete" | "status", s?: ListingStatus) {
    if (!selected.size) return;
    await api.bulkListings(searchId, {
      ids: [...selected],
      op,
      ...(s ? { status: s } : {})
    });
    toast(`Bulk ${op} done (${selected.size})`);
    await reload();
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="page-h">
        <h2>Listings</h2>
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
          <option value="">Published + drafts</option>
          <option value="true">Published only</option>
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
            Publish
          </button>
          <button className="btn" type="button" onClick={() => void bulk("unpublish")}>
            Unpublish
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
              <th>€/m²</th>
              <th>Published</th>
              <th>Viewing</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {listings.map((l) => {
              const psqm = pricePerSqm(l.price, l.sqm);
              const nPhotos = photos.filter((p) => p.listingId === l.id).length;
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
                      {l.kiez ? ` · ${l.kiez}` : ""} · {nPhotos} photo{nPhotos === 1 ? "" : "s"}
                    </small>
                  </td>
                  <td>
                    <select
                      className="pill pillsel"
                      data-st={l.status}
                      value={l.status}
                      onChange={(e) =>
                        void api
                          .patchListing(searchId, l.id, "status", {
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
                  <td className="num">{l.price ? eur(l.price) : "—"}</td>
                  <td className="num">{psqm ? eur(psqm) : "—"}</td>
                  <td>
                    <label className="paidbox">
                      <input
                        type="checkbox"
                        checked={l.published}
                        onChange={(e) =>
                          void api
                            .patchListing(searchId, l.id, "publish", {
                              published: e.target.checked
                            })
                            .then(() => {
                              toast(e.target.checked ? "Published" : "Unpublished");
                              return reload();
                            })
                        }
                      />{" "}
                      {l.published ? "Live" : "Draft"}
                    </label>
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
                          void api.deleteListing(searchId, l.id).then(() => {
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

      <Inbox searchId={searchId} onConvert={(t) => setEditor(t)} toast={toast} />

      {editor && (
        <ListingEditor
          searchId={searchId}
          target={editor}
          onClose={() => setEditor(null)}
          onSaved={() => void reload()}
          toast={toast}
        />
      )}
      {photoTarget && (
        <PhotoManager
          searchId={searchId}
          listing={photoTarget}
          photos={photos.filter((p) => p.listingId === photoTarget.id)}
          onClose={() => setPhotoTarget(null)}
          onChanged={() => void reload()}
          toast={toast}
        />
      )}
      {toastEl}
    </section>
  );
}

function Inbox({
  searchId,
  onConvert,
  toast
}: {
  searchId: string;
  onConvert: (t: EditorTarget) => void;
  toast: (m: string) => void;
}) {
  const [sources, setSources] = useState<{ id: string; url: string; status: string; listingId: string | null }[]>([]);
  const [urls, setUrls] = useState("");

  const reload = useCallback(
    () => api.inbox(searchId).then((r) => setSources(r.items)),
    [searchId]
  );
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
          void api.addInbox(searchId, list).then((r) => {
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
                  onClick={() =>
                    onConvert({ listing: null, sourceId: s.id, sourceUrl: s.url })
                  }
                >
                  Convert
                </button>
                <DangerButton
                  onConfirm={() =>
                    void api.deleteInbox(searchId, s.id).then(() => reload())
                  }
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
  searchId,
  listing,
  photos,
  onClose,
  onChanged,
  toast
}: {
  searchId: string;
  listing: Listing;
  photos: PhotoWithUrl[];
  onClose: () => void;
  onChanged: () => void;
  toast: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<PhotoKind>("photo");

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    let ok = 0;
    try {
      for (const file of [...files]) {
        if (!/^image\/(jpeg|png|webp)$/.test(file.type)) continue;
        const presigned = await api.presign(searchId, listing.id, kind, file.type);
        const put = await fetch(presigned.uploadUrl, {
          method: "PUT",
          headers: presigned.headers,
          body: file
        });
        if (!put.ok) throw new Error(`Upload failed (${put.status})`);
        await api.confirmPhoto(searchId, listing.id, presigned.photoId);
        ok++;
      }
      toast(`Added ${ok} ${kind === "floorplan" ? "floor plan" : "photo"}${ok === 1 ? "" : "s"}`);
      onChanged();
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
    await api.reorderPhotos(searchId, listing.id, ofKind, list);
    onChanged();
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
                  void api.deletePhoto(searchId, listing.id, p.id).then(() => {
                    toast("Photo deleted");
                    onChanged();
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
