import { useState } from "react";
import {
  districtNumber,
  DISTRICTS,
  ORTSTEILE,
  type Brief,
  type Settings
} from "@jj/shared";
import { eur } from "../lib/format";
import { track } from "../tracking";

const dColor = (name: string) => `var(--d${districtNumber(name)})`;

function GeoPlates({ brief }: { brief: Brief }) {
  const plates: { num: string; label: string }[] = [];
  for (const { num, name } of DISTRICTS) {
    if (brief.districts.includes(name)) {
      plates.push({ num, label: name });
    } else {
      for (const ort of ORTSTEILE[name]) {
        if (brief.ortsteile.includes(ort)) plates.push({ num, label: ort });
      }
    }
  }
  if (!plates.length) return <span className="note-line">Anywhere in Berlin</span>;
  return (
    <>
      {plates.map((p) => (
        <span className="plate splate" key={`${p.num}-${p.label}`}>
          <span className="pn">{p.num}</span>
          <span className="pb">{p.label}</span>
        </span>
      ))}
    </>
  );
}

export function BriefPanel({
  brief,
  settings
}: {
  brief: Brief;
  settings: Settings;
}) {
  const [open, setOpen] = useState(false);
  const budget = brief.budget || settings.budget || 0;
  const empty =
    !budget &&
    !brief.minSqm &&
    !brief.minBeds &&
    !brief.districts.length &&
    !brief.ortsteile.length &&
    !brief.timeline &&
    !brief.must.length &&
    !brief.nice.length &&
    !brief.no.length &&
    !brief.notes;
  const nAreas = brief.districts.length + brief.ortsteile.length;
  const summary = empty
    ? ""
    : [
        budget ? `max ${eur(budget)} all-in` : "",
        brief.minSqm ? `${brief.minSqm} m²+` : "",
        brief.minBeds ? `${brief.minBeds}+ bedrooms` : "",
        nAreas ? `${nAreas} search area${nAreas > 1 ? "s" : ""}` : ""
      ]
        .filter(Boolean)
        .join(" · ");

  const list = (cls: string, heading: string, items: string[]) =>
    items.length ? (
      <div className={cls}>
        <h4>{heading}</h4>
        <ul>
          {items.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </div>
    ) : null;

  return (
    <section className="brief" aria-label="Search requirements">
      <div className="brief-h">
        <button
          type="button"
          className="btoggle"
          aria-expanded={open}
          onClick={() => {
            const next = !open;
            setOpen(next);
            if (next) track("brief_viewed");
          }}
        >
          <span className="chev">{open ? "▾" : "▸"}</span>
          <h2>Search requirements</h2>
        </button>
        <span className="bsum">{open ? "" : summary}</span>
      </div>
      {empty ? (
        !open ? null : (
          <p className="note-line" style={{ margin: 0 }}>
            The brief for this search will appear here.
          </p>
        )
      ) : (
        <div className="bbody" hidden={!open}>
          <div className="reqs">
            <div>
              <div className="k">Max all-in budget</div>
              <div className="v">{budget ? eur(budget) : "Open"}</div>
            </div>
            <div>
              <div className="k">Min living area</div>
              <div className="v">{brief.minSqm ? `${brief.minSqm} m²` : "Any"}</div>
            </div>
            <div>
              <div className="k">Min bedrooms</div>
              <div className="v">{brief.minBeds || "Any"}</div>
            </div>
            {brief.timeline && (
              <div>
                <div className="k">Timeline</div>
                <div className="v" style={{ fontSize: 18 }}>
                  {brief.timeline}
                </div>
              </div>
            )}
          </div>
          <div className="geoshow">
            <span className="gtitle">Search areas</span>
            <GeoPlates brief={brief} />
          </div>
          {(brief.must.length || brief.nice.length || brief.no.length) > 0 && (
            <div className="blists">
              {list("must", "Must-haves", brief.must)}
              {list("nice", "Nice-to-haves", brief.nice)}
              {list("no", "Deal-breakers", brief.no)}
            </div>
          )}
          {brief.notes && (
            <p className="notes" style={{ margin: 0 }}>
              <span className="by">Notes</span>
              {brief.notes}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export { dColor };
