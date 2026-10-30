import {
  districtNumber,
  LISTING_STATUS_LABELS,
  type CustomerListing,
  type Rating
} from "@jj/shared";
import { eur } from "../lib/format";
import { Carousel, PhotoPlaceholder, type PhotoWithUrl } from "./Carousel";
import { TileStars } from "./TileStars";

/**
 * Board tile: photos with a NEW tag overlay in the top-left corner, then
 * district plate, star rating and status, then price and size. Everything
 * else lives on the detail page, which the whole tile links to (stretched
 * link; the carousel arrows and the stars sit above it).
 */
export function ListingCard({
  listing,
  photos,
  isNew,
  ratings,
  searchId,
  myName,
  canRate,
  onOpen,
  onRatingsChanged
}: {
  listing: CustomerListing;
  photos: PhotoWithUrl[];
  isNew: boolean;
  ratings: Rating[];
  searchId: string;
  myName: string;
  canRate: boolean;
  onOpen: () => void;
  onRatingsChanged: () => void;
}) {
  const l = listing;
  const gallery = photos.filter((p) => p.kind === "photo");
  const n = districtNumber(l.bezirk);

  return (
    <article
      className={`card tile st-${l.status}${l.benchmark ? " is-bench" : ""}`}
      id={`card-${l.id}`}
    >
      {gallery.length > 0 ? (
        <Carousel listing={l} photos={gallery} />
      ) : (
        <PhotoPlaceholder listing={l} />
      )}
      {isNew && <span className="newtag tile-new">NEW</span>}
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
          <TileStars
            searchId={searchId}
            listingId={l.id}
            ratings={ratings}
            myName={myName}
            canRate={canRate}
            onChanged={onRatingsChanged}
          />
          <span className="pill" data-st={l.status}>
            {LISTING_STATUS_LABELS[l.status]}
          </span>
        </span>
      </div>
      <a
        className="tile-link"
        href={`#listing-${l.id}`}
        aria-label={`${l.title}: see all details`}
        onClick={(e) => {
          e.preventDefault();
          onOpen();
        }}
      >
        <span className="price">{l.price ? eur(l.price) : "Price n/a"}</span>
        <span className="size">{l.sqm ? `${l.sqm} m²` : "Size n/a"}</span>
      </a>
    </article>
  );
}
