/** Key layout for media-table (owned exclusively by the media service).
 *
 *  PHOTO items:   PK LISTING#<lid> / SK PHOTO#<pid>
 *                 GSI1PK SEARCH#<sid> / GSI1SK PHOTO#<lid>#<pid>
 *  LISTING META:  PK LISTING#<lid> / SK META
 *    — event-carried state (published flag) consumed from the listing
 *      service's domain events, so the customer photo endpoint can filter
 *      without reading another service's table. */
export const mediaKeys = {
  photo: (listingId: string, photoId: string) => ({
    PK: `LISTING#${listingId}`,
    SK: `PHOTO#${photoId}`
  }),
  photoGsi: (searchId: string, listingId: string, photoId: string) => ({
    GSI1PK: `SEARCH#${searchId}`,
    GSI1SK: `PHOTO#${listingId}#${photoId}`
  }),
  listingMeta: (listingId: string) => ({
    PK: `LISTING#${listingId}`,
    SK: "META"
  })
} as const;

export const SEARCH_PHOTOS_INDEX = "GSI1";

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

export function photoS3Key(
  searchId: string,
  listingId: string,
  photoId: string,
  contentType: string
): string {
  const ext = EXT[contentType] ?? "bin";
  return `searches/${searchId}/listings/${listingId}/${photoId}.${ext}`;
}
