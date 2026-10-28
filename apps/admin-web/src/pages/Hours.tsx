import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  HOURS_CATEGORIES,
  type HoursCategory,
  type HoursEntry,
  type Listing,
  type Search,
  type Timer
} from "@jj/shared";
import { api } from "../api/client";
import { eur, fmtMonth, hm, todayISO } from "../lib/format";
import { parseDuration } from "../lib/parse";
import { DangerButton, Field, useToast } from "../components/ui";

export function Hours({ search }: { search: Search }) {
  const searchId = search.id;
  const rate = search.settings.rate || 0;
  const [entries, setEntries] = useState<HoursEntry[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [timer, setTimer] = useState<Timer | null>(null);
  const [now, setNow] = useState(Date.now());
  const [toastEl, toast] = useToast();

  const reload = useCallback(async () => {
    const [h, l, t] = await Promise.all([
      api.hours(searchId),
      api.listings(),
      api.timer(searchId)
    ]);
    setEntries(h.items);
    setListings(l.items);
    setTimer(t.timer);
  }, [searchId]);

  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  /* log form */
  const [date, setDate] = useState(todayISO());
  const [dur, setDur] = useState("");
  const [cat, setCat] = useState<HoursCategory>("Research");
  const [listingId, setListingId] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  async function add(e: FormEvent) {
    e.preventDefault();
    const minutes = parseDuration(dur);
    if (!minutes) {
      setErr("Enter a duration like 1:30, 1.5 or 45m.");
      return;
    }
    setErr("");
    await api.addHours(searchId, {
      date,
      minutes,
      category: cat,
      listingId: listingId || null,
      note: note.trim()
    });
    setDur("");
    setNote("");
    toast(`Logged ${hm(minutes)}`);
    await reload();
  }

  /* timer */
  const [tCat, setTCat] = useState<HoursCategory>("Research");
  const [tNote, setTNote] = useState("");
  const elapsed = timer
    ? Math.max(0, Math.floor((now - new Date(timer.startedAt).getTime()) / 1000))
    : 0;
  const clock = `${Math.floor(elapsed / 3600)}:${String(Math.floor(elapsed / 60) % 60).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  const total = entries.reduce((a, h) => a + h.minutes, 0);
  const paid = entries.filter((h) => h.paid).reduce((a, h) => a + h.minutes, 0);
  const months = new Map<string, HoursEntry[]>();
  for (const h of entries) {
    const key = h.date.slice(0, 7);
    months.set(key, [...(months.get(key) ?? []), h]);
  }
  const money = (min: number) => (rate ? ` · ${eur((min / 60) * rate)}` : "");
  const listingTitle = (id: string | null) =>
    id ? listings.find((l) => l.id === id)?.title : undefined;

  return (
    <div className="hours-layout">
      <div className="side">
        <form className="panel" onSubmit={add}>
          <h2>Log time</h2>
          <div className="two">
            <Field label="Date">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Duration">
              <input value={dur} placeholder="1:30 or 1.5" onChange={(e) => setDur(e.target.value)} />
            </Field>
          </div>
          <Field label="Task">
            <select value={cat} onChange={(e) => setCat(e.target.value as HoursCategory)}>
              {HOURS_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Listing">
            <select value={listingId} onChange={(e) => setListingId(e.target.value)}>
              <option value="">— None —</option>
              {listings.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Note">
            <input
              value={note}
              placeholder="Called agent about service charge history"
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          {err && <p className="err">{err}</p>}
          <button className="btn primary" type="submit">
            Add entry
          </button>
        </form>

        <div className="panel">
          <h2>Timer</h2>
          <div className={`clock${timer ? " running" : ""}`}>{clock}</div>
          {timer ? (
            <>
              <p className="note-line" style={{ margin: 0 }}>
                {timer.category}
                {timer.note ? ` — ${timer.note}` : ""}
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn primary"
                  type="button"
                  onClick={() =>
                    void api.stopTimer(searchId).then((entry) => {
                      toast(`Logged ${hm(entry.minutes)}`);
                      return reload();
                    })
                  }
                >
                  Stop &amp; log
                </button>
                <button
                  className="btn danger"
                  type="button"
                  onClick={() =>
                    void api.discardTimer(searchId).then(() => {
                      toast("Timer discarded");
                      return reload();
                    })
                  }
                >
                  Discard
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="two">
                <Field label="Task">
                  <select value={tCat} onChange={(e) => setTCat(e.target.value as HoursCategory)}>
                    {HOURS_CATEGORIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Note">
                  <input value={tNote} onChange={(e) => setTNote(e.target.value)} />
                </Field>
              </div>
              <button
                className="btn primary"
                type="button"
                onClick={() =>
                  void api.startTimer(searchId, tCat, tNote.trim()).then(() => reload())
                }
              >
                Start timer
              </button>
            </>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="ledger-h">
          <h2>Hours ledger</h2>
          {rate > 0 && <span className="rate">{eur(rate)} / hour</span>}
        </div>
        <div className="totals">
          <div>
            <div className="v">{hm(total)}</div>
            <div className="k">Total{money(total)}</div>
          </div>
          <div>
            <div className="v paidv">{hm(paid)}</div>
            <div className="k">Paid{money(paid)}</div>
          </div>
          <div>
            <div className="v openv">{hm(total - paid)}</div>
            <div className="k">Outstanding{money(total - paid)}</div>
          </div>
        </div>
        {[...months.keys()]
          .sort()
          .reverse()
          .map((key) => {
            const rows = months
              .get(key)!
              .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
            const monthTotal = rows.reduce((a, h) => a + h.minutes, 0);
            const monthOpen = rows.filter((h) => !h.paid).reduce((a, h) => a + h.minutes, 0);
            return (
              <div className="month" key={key}>
                <div className="month-h">
                  <h3>{fmtMonth(key)}</h3>
                  <span>
                    {hm(monthTotal)}
                    {money(monthTotal)}
                    {monthOpen === 0 && (
                      <>
                        {" "}
                        <span className="paidtag">Paid</span>
                      </>
                    )}
                  </span>
                </div>
                {monthOpen > 0 && (
                  <div className="mact">
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={() =>
                        void api.payMonth(searchId, key).then((r) => {
                          toast(
                            `Marked ${r.items.length} entr${r.items.length === 1 ? "y" : "ies"} as paid`
                          );
                          return reload();
                        })
                      }
                    >
                      Mark all {fmtMonth(key)} as paid
                    </button>
                  </div>
                )}
                {rows.map((h) => (
                  <div className="entry" key={h.id}>
                    <span className="d">{h.date.slice(5)}</span>
                    <span className="what">
                      <span>
                        <span className="cat">{h.category}</span>
                        {h.note}
                      </span>
                      {listingTitle(h.listingId) && <small>{listingTitle(h.listingId)}</small>}
                    </span>
                    <span className="dur">
                      {hm(h.minutes)}
                      {rate > 0 && <small className="ecost">{eur((h.minutes / 60) * rate)}</small>}
                    </span>
                    <label className="paidbox">
                      <input
                        type="checkbox"
                        checked={h.paid}
                        onChange={(e) =>
                          void api
                            .updateHours(searchId, h.id, { paid: e.target.checked })
                            .then(() => reload())
                        }
                      />{" "}
                      Paid
                    </label>
                    <span className="eact">
                      <DangerButton
                        onConfirm={() =>
                          void api.deleteHours(searchId, h.id).then(() => {
                            toast("Deleted");
                            return reload();
                          })
                        }
                      />
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        {entries.length === 0 && (
          <p className="note-line">No time logged yet for this search.</p>
        )}
      </div>
      {toastEl}
    </div>
  );
}
