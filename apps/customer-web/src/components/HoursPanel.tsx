import {
  HOURS_CATEGORIES,
  type CustomerListing,
  type HoursEntry,
  type Settings
} from "@jj/shared";
import { eur, fmtDay, fmtMonth, hm } from "../lib/format";

export function HoursPanel({
  hours,
  settings,
  listings
}: {
  hours: HoursEntry[];
  settings: Settings;
  listings: CustomerListing[];
}) {
  const rate = settings.rate || 0;
  const total = hours.reduce((a, h) => a + h.minutes, 0);
  const paid = hours.filter((h) => h.paid).reduce((a, h) => a + h.minutes, 0);
  const open = total - paid;
  const money = (min: number) => (rate ? ` · ${eur((min / 60) * rate)}` : "");
  const listingTitle = (id: string | null) =>
    id ? listings.find((l) => l.id === id)?.title : undefined;

  if (!hours.length) {
    return (
      <div className="panel">
        <h2>Billing</h2>
        <div className="empty">
          <h3>No time logged yet</h3>
          <p>Logged work will show here, grouped by month.</p>
        </div>
      </div>
    );
  }

  const byCat = HOURS_CATEGORIES.map(
    (c) =>
      [c, hours.filter((h) => h.category === c).reduce((a, h) => a + h.minutes, 0)] as const
  )
    .filter(([, m]) => m > 0)
    .sort((a, b) => b[1] - a[1]);
  const max = Math.max(...byCat.map(([, m]) => m), 1);

  const months = new Map<string, HoursEntry[]>();
  for (const h of hours) {
    const key = h.date.slice(0, 7);
    months.set(key, [...(months.get(key) ?? []), h]);
  }
  const monthKeys = [...months.keys()].sort().reverse();

  return (
    <div className="panel">
      <div className="ledger-h">
        <h2>Billing</h2>
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
          <div className="v openv">{hm(open)}</div>
          <div className="k">Outstanding{money(open)}</div>
        </div>
      </div>
      <div className="bars">
        {byCat.map(([c, m]) => (
          <div className="bar" key={c}>
            <span>{c}</span>
            <span className="track">
              <span
                className="fill"
                style={{ width: `${((m / max) * 100).toFixed(1)}%`, display: "block" }}
              ></span>
            </span>
            <span className="val">{hm(m)}</span>
          </div>
        ))}
      </div>
      {monthKeys.map((key) => {
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
                {monthOpen > 0 && monthOpen < monthTotal && (
                  <>
                    {" "}
                    <small className="mopen">{hm(monthOpen)} outstanding</small>
                  </>
                )}
                {monthOpen === 0 && (
                  <>
                    {" "}
                    <span className="paidtag">Paid</span>
                  </>
                )}
              </span>
            </div>
            {rows.map((h) => (
              <div className="entry" key={h.id}>
                <span className="d">{fmtDay(h.date)}</span>
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
                <span className={h.paid ? "paidtag" : "opentag"}>
                  {h.paid ? "Paid" : "Open"}
                </span>
                <span></span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
