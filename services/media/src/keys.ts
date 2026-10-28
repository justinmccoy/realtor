/** Key layout for media-table (owned exclusively by the media service).
 *
 *  PHOTO items:   PK LISTING#<lid> / SK PHOTO#<pid>
 *  LISTING META:  PK LISTING#<lid> / SK META
 *    — event-carried state ({title, published}) from the listing service,
 *      gating customer photo reads without cross-service table reads. */
export const mediaKeys = {
  photo: (listingId: string, photoId: string) => ({
    PK: `LISTING#${listingId}`,
    SK: `PHOTO#${photoId}`
  }),
  listingMeta: (listingId: string) => ({
    PK: `LISTING#${listingId}`,
    SK: "META"
  })
} as const;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

export function photoS3Key(
  listingId: string,
  photoId: string,
  contentType: string
): string {
  const ext = EXT[contentType] ?? "bin";
  return `listings/${listingId}/${photoId}.${ext}`;
}
