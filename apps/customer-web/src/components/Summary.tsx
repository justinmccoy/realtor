import { pricePerSqm, type CustomerListing } from "@jj/shared";
import { eur, fmtViewing } from "../lib/format";

export function Summary({ listings }: { listings: CustomerListing[] }) {
  const active = listings.filter((l) => l.status !== "passed");
  const short = listings.filter((l) =>
    ["short", "viewing", "viewed", "offer"].includes(l.status)
  );
  const now = Date.now();
  const next = listings
    .filter(
      (l) => l.viewingAt && new Date(l.viewingAt).getTime() > now - 36e5
    )
    .sort(
      (a, b) =>
        new Date(a.viewingAt!).getTime() - new Date(b.viewingAt!).getTime()
    )[0];
  const psq = active
    .map((l) => pricePerSqm(l.price, l.sqm))
    .filter((v): v is number => v !== null);
  const avg = psq.length ? psq.reduce((a, b) => a + b, 0) / psq.length : 0;

  return (
    <section className="summary" aria-label="Summary">
      <div className="stat">
        <span className="k">On the board</span>
        <span className="v">{active.length}</span>
        <span className="s">{short.length} shortlisted or further</span>
      </div>
      <div className="stat">
        <span className="k">Avg €/m²</span>
        <span className="v">{avg ? eur(avg) : "—"}</span>
        <span className="s">across active listings</span>
      </div>
      <div className="stat">
        <span className="k">Next viewing</span>
        <span className="v" style={{ fontSize: 22 }}>
          {next?.viewingAt ? fmtViewing(next.viewingAt) : "None booked"}
        </span>
        <span className="s">{next ? next.title : " "}</span>
      </div>
    </section>
  );
}
