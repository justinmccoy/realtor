import { useState, type FormEvent } from "react";
import {
  BALCONY_STATES,
  CONTACT_STATUS_LABELS,
  CONTACT_STATUSES,
  DISTRICTS,
  LISTING_STATUS_LABELS,
  LISTING_STATUSES,
  ORTSTEILE,
  REMODEL_ITEMS,
  listingCreateSchema,
  type DistrictName,
  type Listing,
  type ListingCreateInput,
  type RemodelItem
} from "@jj/shared";
import { api } from "../api/client";
import { isoToLocalInput, localInputToIso } from "../lib/format";
import { linesOf, parseNum, toLines } from "../lib/parse";
import { Field, Modal } from "../components/ui";

export interface EditorTarget {
  listing: Listing | null;
  /** When converting an inbox link: prefill + mark done on save. */
  sourceId?: string;
  sourceUrl?: string;
}

export function ListingEditor({
  searchId,
  target,
  onClose,
  onSaved,
  toast
}: {
  searchId: string;
  target: EditorTarget;
  onClose: () => void;
  onSaved: () => void;
  toast: (m: string) => void;
}) {
  const l = target.listing;
  const [f, setF] = useState(() => ({
    title: l?.title ?? "",
    benchmark: l?.benchmark ?? false,
    published: l?.published ?? false,
    url: l?.url ?? target.sourceUrl ?? "",
    bezirk: (l?.bezirk ?? "Friedrichshain-Kreuzberg") as DistrictName,
    ortsteil: l?.ortsteil ?? "",
    kiez: l?.kiez ?? "",
    price: l?.price != null ? String(l.price) : "",
    sqm: l?.sqm != null ? String(l.sqm) : "",
    beds: l?.beds != null ? String(l.beds) : "",
    rooms: l?.rooms != null ? String(l.rooms) : "",
    baths: l?.baths != null ? String(l.baths) : "",
    balcony: l?.balcony ?? "unknown",
    balconyNote: l?.balconyNote ?? "",
    floor: l?.floor ?? "",
    year: l?.year ?? "",
    hausgeld: l?.hausgeld != null ? String(l.hausgeld) : "",
    provision: l?.provision != null ? String(l.provision) : "",
    status: l?.status ?? "new",
    contact: l?.contact ?? "none",
    viewingAt: isoToLocalInput(l?.viewingAt ?? null),
    vComment: l?.vComment ?? "",
    jjNotes: l?.jjNotes ?? "",
    jjComments: l?.jjComments ?? "",
    pros: toLines(l?.pros ?? []),
    cons: toLines(l?.cons ?? []),
    notes: l?.notes ?? "",
    topRank: l?.topRank ?? 0,
    remodelNone: l?.remodel?.none ?? false,
    remodelItems: new Set<RemodelItem>(l?.remodel?.items ?? []),
    remodelCost: l?.remodel?.cost != null ? String(l.remodel.cost) : "",
    remodelComment: l?.remodel?.comment ?? ""
  }));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) =>
    setF((cur) => ({ ...cur, [k]: v }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setErr("");
    const hasRemodel =
      f.remodelNone || f.remodelItems.size > 0 || f.remodelCost || f.remodelComment;
    const candidate = {
      title: f.title.trim(),
      benchmark: f.benchmark,
      published: f.published,
      url: f.url.trim() || null,
      bezirk: f.bezirk,
      ortsteil: f.ortsteil || null,
      kiez: f.kiez.trim() || null,
      price: parseNum(f.price),
      sqm: parseNum(f.sqm),
      beds: parseNum(f.beds),
      rooms: parseNum(f.rooms),
      baths: parseNum(f.baths),
      balcony: f.balcony,
      balconyNote: f.balconyNote.trim() || null,
      floor: f.floor.trim() || null,
      year: f.year.trim() || null,
      hausgeld: parseNum(f.hausgeld),
      provision: parseNum(f.provision),
      status: f.status,
      contact: f.contact,
      viewingAt: localInputToIso(f.viewingAt),
      vComment: f.vComment,
      jjNotes: f.jjNotes,
      jjComments: f.jjComments,
      pros: linesOf(f.pros),
      cons: linesOf(f.cons),
      notes: f.notes,
      topRank: f.topRank,
      remodel: hasRemodel
        ? {
            none: f.remodelNone,
            items: f.remodelNone ? [] : [...f.remodelItems],
            cost: f.remodelNone ? null : parseNum(f.remodelCost),
            comment: f.remodelComment.trim()
          }
        : null
    };
    const parsed = listingCreateSchema.safeParse(candidate);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      setErr(`${first?.path.join(".")}: ${first?.message}`);
      return;
    }
    const body: ListingCreateInput = parsed.data;
    setBusy(true);
    try {
      const saved = l
        ? await api.updateListing(searchId, l.id, body)
        : await api.createListing(searchId, body);
      if (target.sourceId) {
        await api.patchInbox(searchId, target.sourceId, {
          status: "done",
          listingId: saved.id
        });
      }
      toast(l ? "Listing updated" : "Listing added");
      onSaved();
      onClose();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  const text = (
    label: string,
    key: keyof typeof f,
    opts: { placeholder?: string; hint?: string } = {}
  ) => (
    <Field label={label} hint={opts.hint}>
      <input
        value={f[key] as string}
        placeholder={opts.placeholder}
        onChange={(e) => set(key, e.target.value as never)}
      />
    </Field>
  );
  const area = (label: string, key: keyof typeof f, placeholder?: string) => (
    <Field label={label}>
      <textarea
        value={f[key] as string}
        placeholder={placeholder}
        onChange={(e) => set(key, e.target.value as never)}
      />
    </Field>
  );

  return (
    <Modal title={l ? "Edit listing" : "Add listing"} onClose={onClose}>
      <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 14 }} noValidate>
        {text("Title", "title", { placeholder: "Bright Altbau with balcony" })}
        <label className="bmk">
          <input
            type="checkbox"
            checked={f.benchmark}
            onChange={(e) => set("benchmark", e.target.checked)}
          />{" "}
          This is the benchmark apartment other listings are compared against
        </label>
        <label className="bmk">
          <input
            type="checkbox"
            checked={f.published}
            onChange={(e) => set("published", e.target.checked)}
          />{" "}
          Published — visible to the client
        </label>
        {text("Source link", "url", {
          placeholder: "https://www.immobilienscout24.de/expose/…"
        })}
        <div className="two">
          <Field label="District">
            <select
              value={f.bezirk}
              onChange={(e) => {
                set("bezirk", e.target.value as DistrictName);
                set("ortsteil", "");
              }}
            >
              {DISTRICTS.map(({ num, name }) => (
                <option key={name} value={name}>
                  {num} · {name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Area">
            <select value={f.ortsteil} onChange={(e) => set("ortsteil", e.target.value)}>
              <option value="">Not set</option>
              {ORTSTEILE[f.bezirk].map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </Field>
          {text("Neighbourhood / street", "kiez", {
            placeholder: "Bergmannkiez, Zossener Str."
          })}
        </div>
        <div className="three">
          {text("Purchase price €", "price", { placeholder: "489000" })}
          {text("Living area m²", "sqm", { placeholder: "78" })}
          {text("Bedrooms", "beds", { hint: "Separate bedrooms only" })}
          {text("Rooms (German count)", "rooms", {
            hint: '"Zimmer": includes the living room'
          })}
          {text("Bathrooms", "baths")}
          <Field label="Balcony">
            <select
              value={f.balcony}
              onChange={(e) => set("balcony", e.target.value as (typeof BALCONY_STATES)[number])}
            >
              <option value="unknown">Not known</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </Field>
          {text("Balcony details", "balconyNote", {
            placeholder: "South-west, approx. 6 m²"
          })}
          {text("Floor", "floor", { placeholder: "3rd floor" })}
          {text("Year built", "year", { placeholder: "1905" })}
          {text("Service charge €/mo", "hausgeld", { placeholder: "340" })}
        </div>
        <div className="three">
          {text("Buyer's commission %", "provision", {
            hint: "Empty = search default · 0 if commission-free"
          })}
          <Field label="Status">
            <select
              value={f.status}
              onChange={(e) => set("status", e.target.value as typeof f.status)}
            >
              {LISTING_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {LISTING_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="JJ's top 5">
            <select
              value={f.topRank}
              onChange={(e) => set("topRank", Number(e.target.value))}
            >
              <option value={0}>Not ranked</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  #{n}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="two">
          {area("Pros, one per line", "pros")}
          {area("Cons, one per line", "cons")}
        </div>
        {area("Listing notes", "notes")}
        <Field label="Comments by JJ" hint="Shown prominently to the client">
          <textarea
            value={f.jjComments}
            placeholder="Your take for the client"
            onChange={(e) => set("jjComments", e.target.value)}
          />
        </Field>

        <fieldset className="vset">
          <legend>Viewing</legend>
          <div className="two">
            <Field label="Contact status">
              <select
                value={f.contact}
                onChange={(e) => set("contact", e.target.value as typeof f.contact)}
              >
                {CONTACT_STATUSES.map((c) => (
                  <option key={c} value={c}>
                    {CONTACT_STATUS_LABELS[c]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Viewing date & time">
              <input
                type="datetime-local"
                value={f.viewingAt}
                onChange={(e) => set("viewingAt", e.target.value)}
              />
            </Field>
          </div>
          <Field label="Comments from the viewing">
            <textarea
              value={f.vComment}
              placeholder="Light, condition, noise, the building, the neighbours…"
              onChange={(e) => set("vComment", e.target.value)}
            />
          </Field>
          <Field label="JJ's other notes" hint="Admin-private — never shown to the client">
            <textarea
              value={f.jjNotes}
              placeholder="Agent's contact, documents requested, follow-ups…"
              onChange={(e) => set("jjNotes", e.target.value)}
            />
          </Field>
        </fieldset>

        <fieldset className="vset">
          <legend>Remodelling</legend>
          <label className="rnone">
            <input
              type="checkbox"
              checked={f.remodelNone}
              onChange={(e) => set("remodelNone", e.target.checked)}
            />{" "}
            No remodelling needed
          </label>
          <div className="rboxes">
            {REMODEL_ITEMS.map((item) => (
              <label key={item}>
                <input
                  type="checkbox"
                  disabled={f.remodelNone}
                  checked={!f.remodelNone && f.remodelItems.has(item)}
                  onChange={(e) => {
                    const items = new Set(f.remodelItems);
                    if (e.target.checked) items.add(item);
                    else items.delete(item);
                    set("remodelItems", items);
                  }}
                />{" "}
                {item}
              </label>
            ))}
          </div>
          <div className="two">
            {text("Estimated cost € (optional)", "remodelCost", { placeholder: "25000" })}
            {text("Comment", "remodelComment", {
              placeholder: "What needs doing and how urgent?"
            })}
          </div>
        </fieldset>

        {err && <p className="err">{err}</p>}
        <div className="sheet-f">
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" type="submit" disabled={busy}>
            Save listing
          </button>
        </div>
      </form>
    </Modal>
  );
}
