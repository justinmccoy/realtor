import {
  allInCost,
  CONTACT_STATUS_LABELS,
  districtNumber,
  LISTING_STATUS_LABELS,
  pricePerSqm,
  type Brief,
  type Comment,
  type CustomerListing,
  type Rating,
  type Settings,
} from "@jj/shared";
import {
  Carousel,
  PhotoPlaceholder,
  type PhotoWithUrl,
} from "../components/Carousel";
import { CommentThread } from "../components/Comments";
import { RatingBlock } from "../components/RatingBlock";
import { benchChips, fitChips, mapUrl, siteName, type Chip } from "../lib/fit";
import { eur, fmtViewing } from "../lib/format";
import { track } from "../tracking";

function Chips({ chips, bench }: { chips: Chip[]; bench?: boolean }) {
  if (!chips.length) return null;
  return (
    <div className={`fit${bench ? " bench" : ""}`}>
      {chips.map((c) => (
        <span key={c.text} className={c.ok ? "" : "miss"}>
          {c.text}
        </span>
      ))}
    </div>
  );
}

/** Full listing page: everything the board tile leaves out. */
export function ListingDetail({
  listing,
  benchmark,
  brief,
  settings,
  photos,
  ratings,
  comments,
  searchId,
  canRate,
  isNew,
  onBack,
  onZoom,
  onRatingsChanged,
  onCommentsChanged,
}: {
  listing: CustomerListing;
  benchmark: CustomerListing | undefined;
  brief: Brief;
  settings: Settings;
  photos: PhotoWithUrl[];
  ratings: Rating[];
  comments: Comment[];
  searchId: string;
  canRate: boolean;
  isNew: boolean;
  onBack: () => void;
  onZoom: (urls: string[], idx: number) => void;
  onRatingsChanged: () => void;
  onCommentsChanged: () => void;
}) {
  const l = listing;
  const n = districtNumber(l.bezirk);
  const cost = allInCost(l.price, settings, l.provision);
  const psqm = pricePerSqm(l.price, l.sqm);
  const over =
    settings.budget > 0 && cost !== null && cost.total > settings.budget;
  const gallery = photos.filter((p) => p.kind === "photo");
  const floorplans = photos.filter((p) => p.kind === "floorplan");
  const viewing = l.viewingAt ? new Date(l.viewingAt) : null;
  const viewingPast = viewing !== null && viewing.getTime() < Date.now();
  const listingRatings = ratings.filter((r) => r.listingId === l.id);
  const avg = listingRatings.length
    ? listingRatings.reduce((a, r) => a + r.score, 0) / listingRatings.length
    : 0;
  const nComments = comments.filter(
    (c) => c.listingId === l.id && !c.deletedAt,
  ).length;
  const contactLabel = CONTACT_STATUS_LABELS[l.contact];
  const remodel = l.remodel;
  const remodelState = remodel?.none
    ? "none"
    : remodel?.items.length
      ? "some"
      : "unknown";

  return (
    <section className="detail-page">
      <div className="detail-nav">
        <button className="btn" type="button" onClick={onBack}>
          ‹ All listings
        </button>
      </div>

      <div className="detail-layout">
        <article
          className={`card detail st-${l.status}${l.benchmark ? " is-bench" : ""}`}
        >
          {gallery.length > 0 ? (
            <Carousel listing={l} photos={gallery} onZoom={onZoom} />
          ) : (
            <PhotoPlaceholder listing={l} />
          )}
          <div className="card-top">
            <span
              className="plate dplate"
              style={{ ["--dc" as string]: `var(--d${n})` }}
              title={`District ${n} · ${l.bezirk}`}
            >
              <span className="pn">{n}</span>
              <span className="pb">{l.ortsteil ?? l.bezirk}</span>
            </span>
            <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {isNew && <span className="newtag">NEW</span>}
              <span className="pill" data-st={l.status}>
                {LISTING_STATUS_LABELS[l.status]}
              </span>
            </span>
          </div>
          <h3>{l.title}</h3>
          {l.kiez && (
            <p className="addr">
              {l.kiez}{" "}
              <a
                className="maplink"
                href={mapUrl(l)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => track("map_clicked", l.id)}
              >
                Map ↗
              </a>
            </p>
          )}
          <div className="price-row">
            <span className="price">
              {l.price ? eur(l.price) : "Price n/a"}
            </span>
            {psqm && <span className="psqm">{eur(psqm)} / m²</span>}
          </div>
          {l.benchmark ? (
            <div className="benchtag">
              Benchmark · the apartment the search started from
            </div>
          ) : (
            <Chips chips={benchChips(l, benchmark)} bench />
          )}
          <Chips chips={fitChips(l, brief, settings)} />
          <dl className="facts">
            <div>
              <dt>Area</dt>
              <dd>{l.sqm ? `${l.sqm} m²` : "—"}</dd>
            </div>
            <div>
              <dt>Bedrooms</dt>
              <dd>
                {l.beds ?? "?"}
                <small className="sub">
                  {[
                    l.rooms ? `${l.rooms} rooms (DE)` : "",
                    l.baths ? `${l.baths} bath` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </dd>
            </div>
            <div>
              <dt>Floor</dt>
              <dd>{l.floor ?? "—"}</dd>
            </div>
            <div>
              <dt>Built</dt>
              <dd>{l.year ?? "—"}</dd>
            </div>
            <div>
              <dt>Balcony</dt>
              <dd
                className={
                  l.balcony === "yes" ? "byes" : l.balcony === "no" ? "bno" : ""
                }
              >
                {l.balcony === "yes" ? "Yes" : l.balcony === "no" ? "No" : "?"}
                {l.balconyNote && (
                  <small className="sub">{l.balconyNote}</small>
                )}
              </dd>
            </div>
          </dl>

          <div className="glance">
            {cost && (
              <span>
                <b>{eur(cost.total)}</b> all-in
              </span>
            )}
            <span className="gstars">
              {listingRatings.length ? (
                <>
                  <span className="on">★</span> {avg.toFixed(1)}{" "}
                  <small>({listingRatings.length})</small>
                </>
              ) : (
                <small>No ratings</small>
              )}
            </span>
            {remodelState === "none" && (
              <span className="rmini2 ok">No works needed</span>
            )}
            {remodelState === "some" && remodel && (
              <span className="rmini2">
                Works:{" "}
                {remodel.items.length > 2
                  ? `${remodel.items.length} areas`
                  : remodel.items.join(", ")}
              </span>
            )}
            <span className="cstat" data-c={l.contact}>
              {viewing && l.contact !== "viewed"
                ? `Viewing ${viewing.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
                : contactLabel}
            </span>
          </div>

          {cost && l.price && (
            <div className="allin">
              <div className="row">
                <span>All-in purchase cost</span>
                <b>{eur(cost.total)}</b>
              </div>
              <div className="row">
                <small>
                  +{settings.gre}% transfer tax · +{settings.notary}% notary · +
                  {cost.provision}% commission
                </small>
                {over && <span className="over">Over budget</span>}
              </div>
              {l.hausgeld != null && l.hausgeld > 0 && (
                <div className="row">
                  <small>Service charge</small>
                  <small className="num">{eur(l.hausgeld)} / month</small>
                </div>
              )}
            </div>
          )}

          <RatingBlock
            searchId={searchId}
            listingId={l.id}
            ratings={ratings}
            myUserIdHint=""
            canRate={canRate}
            onChanged={onRatingsChanged}
          />

          <div className="vbox">
            <div className="vbox-h">
              <h4>Viewing</h4>
              <span className="cstat" data-c={l.contact}>
                {contactLabel}
              </span>
            </div>
            {viewing && (
              <div className="viewing">
                <span className="dot"></span>
                {viewingPast ? "Viewed" : "Viewing"} {fmtViewing(l.viewingAt!)}
              </div>
            )}
            {l.vComment && (
              <p className="vt">
                <b>From the viewing</b>
                {l.vComment}
              </p>
            )}
          </div>

          {(l.pros.length > 0 || l.cons.length > 0) && (
            <div className="pc">
              <div>
                <h4>Pros</h4>
                <ul className="plus">
                  {l.pros.length ? (
                    l.pros.map((p) => <li key={p}>{p}</li>)
                  ) : (
                    <li>—</li>
                  )}
                </ul>
              </div>
              <div>
                <h4>Cons</h4>
                <ul className="minus">
                  {l.cons.length ? (
                    l.cons.map((c) => <li key={c}>{c}</li>)
                  ) : (
                    <li>—</li>
                  )}
                </ul>
              </div>
            </div>
          )}

          {l.notes && (
            <p className="notes">
              <span className="by">Notes</span>
              {l.notes}
            </p>
          )}

          {remodel && remodelState !== "unknown" && (
            <div className="remo" data-st={remodelState}>
              <div className="vbox-h">
                <h4>Remodelling</h4>
                <span className="rstat">
                  {remodelState === "none"
                    ? "No remodelling needed"
                    : "Remodelling needed"}
                </span>
              </div>
              {remodel.items.length > 0 && (
                <div className="rchips">
                  {remodel.items.map((x) => (
                    <span key={x}>{x}</span>
                  ))}
                </div>
              )}
              {remodel.cost != null && remodel.cost > 0 && cost && (
                <div className="rcost">
                  Estimated cost <b>{eur(remodel.cost)}</b> · all-in incl. works{" "}
                  {eur(cost.total + remodel.cost)}
                </div>
              )}
              {remodel.comment && <p className="vt">{remodel.comment}</p>}
            </div>
          )}

          {l.jjComments && (
            <div className="jjc">
              <div className="vbox-h">
                <h4>Comments by JJ</h4>
              </div>
              <p className="jjtext">{l.jjComments}</p>
            </div>
          )}

          {floorplans.length > 0 && (
            <div className="fplan">
              <div className="vbox-h">
                <h4>Floor plan</h4>
              </div>
              <div className="fpgrid">
                {floorplans.map((f) => (
                  <figure key={f.id}>
                    <img
                      src={f.url}
                      alt={`Floor plan of ${l.title}`}
                      onClick={() => {
                        track("floorplan_viewed", l.id);
                        onZoom(
                          floorplans.map((x) => x.url),
                          floorplans.indexOf(f),
                        );
                      }}
                    />
                  </figure>
                ))}
              </div>
            </div>
          )}

          <div className="card-foot">
            <span></span>
            <span className="ed">
              <button
                className="btn ghost"
                type="button"
                title="Copy a direct link to this apartment"
                onClick={() => {
                  const url = `${location.origin}${location.pathname}#listing-${l.id}`;
                  void navigator.clipboard.writeText(url);
                }}
              >
                Link
              </button>
              {l.url && (
                <a
                  className="expose btn ghost"
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => track("expose_clicked", l.id)}
                >
                  View on {siteName(l.url)} ↗
                </a>
              )}
            </span>
          </div>
        </article>

        <aside className="panel detail-side" aria-label="Comments">
          <div className="inbox-h">
            <h2>Comments{nComments ? ` (${nComments})` : ""}</h2>
          </div>
          <CommentThread
            searchId={searchId}
            listingId={l.id}
            comments={comments}
            onChanged={onCommentsChanged}
            placeholder="Ask or note something about this apartment…"
            canComment={canRate}
          />
        </aside>
      </div>
    </section>
  );
}
