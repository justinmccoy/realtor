import { useState } from "react";
import { districtNumber, type CustomerListing, type Photo } from "@jj/shared";
import { track } from "../tracking";

export type PhotoWithUrl = Photo & { url: string };

/**
 * Photo strip shared by the listing tile and the detail page. When `onZoom`
 * is given, tapping the picture opens the lightbox; without it the picture
 * is inert so the tile's stretched link can take the click.
 */
export function Carousel({
  listing,
  photos,
  onZoom
}: {
  listing: CustomerListing;
  photos: PhotoWithUrl[];
  onZoom?: (urls: string[], idx: number) => void;
}) {
  const [idx, setIdx] = useState(0);
  if (!photos.length) return null;
  const i = Math.min(idx, photos.length - 1);
  const current = photos[i]!;
  const nav = (d: number) => {
    setIdx((i + d + photos.length) % photos.length);
    track("photo_viewed", listing.id);
  };
  return (
    <div className="photo">
      <img
        src={current.url}
        alt={`${listing.title} photo ${i + 1}`}
        style={onZoom ? undefined : { cursor: "pointer" }}
        onClick={
          onZoom
            ? () => {
                track("photo_viewed", listing.id);
                onZoom(photos.map((p) => p.url), i);
              }
            : undefined
        }
      />
      {photos.length > 1 && (
        <>
          <button className="nav l" type="button" aria-label="Previous photo" onClick={() => nav(-1)}>
            ‹
          </button>
          <button className="nav r" type="button" aria-label="Next photo" onClick={() => nav(1)}>
            ›
          </button>
        </>
      )}
      <span className="count">
        {i + 1} / {photos.length}
      </span>
    </div>
  );
}

/** District-coloured stand-in for listings that have no photos yet. */
export function PhotoPlaceholder({ listing }: { listing: CustomerListing }) {
  const n = districtNumber(listing.bezirk);
  return (
    <div
      className="photo photo-ph"
      style={{ ["--dc" as string]: `var(--d${n})` }}
      aria-hidden="true"
    >
      <span className="ph-num">{n}</span>
      <span className="ph-name">{listing.ortsteil ?? listing.bezirk}</span>
    </div>
  );
}
