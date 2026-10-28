import { allInCost, pricePerSqm, type CustomerListing, type Settings } from "@jj/shared";
import { eur } from "../lib/format";

export function Top5({
  listings,
  settings,
  onGoto
}: {
  listings: CustomerListing[];
  settings: Settings;
  onGoto: (id: string) => void;
}) {
  const picks = listings
    .filter((l) => l.topRank >= 1 && l.topRank <= 5)
    .sort((a, b) => a.topRank - b.topRank);
  if (!picks.length) return null;
  return (
    <section className="top5">
      <div className="inbox-h">
        <h2>JJ's top 5</h2>
        <span className="note-line">{picks.length} of 5 picked</span>
      </div>
      <ol className="t5">
        {picks.map((l) => {
          const cost = allInCost(l.price, settings, l.provision);
          const psqm = pricePerSqm(l.price, l.sqm);
          const meta = [
            l.bezirk,
            l.price ? eur(l.price) : "",
            psqm ? `${eur(psqm)}/m²` : "",
            l.sqm ? `${l.sqm} m²` : "",
            l.beds != null ? `${l.beds} bed` : "",
            cost ? `all-in ${eur(cost.total)}` : ""
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={l.id}>
              <span className="t5n">{l.topRank}</span>
              <div className="t5b">
                <button type="button" className="t5title" onClick={() => onGoto(l.id)}>
                  {l.title}
                </button>
                <span className="t5m">{meta}</span>
                {l.jjComments && <span className="t5c">{l.jjComments}</span>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
