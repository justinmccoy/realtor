/** Key layout for listing-table (owned exclusively by the listing service).
 *  GSI1 is a sparse "upcoming viewings" index across all searches: keys are
 *  only present while a listing has a viewing date set. */
export const listingKeys = {
  listing: (searchId: string, listingId: string) => ({
    PK: `SEARCH#${searchId}`,
    SK: `LISTING#${listingId}`
  }),
  source: (searchId: string, sourceId: string) => ({
    PK: `SEARCH#${searchId}`,
    SK: `SOURCE#${sourceId}`
  }),
  viewingGsi: (viewingAt: string, listingId: string) => ({
    GSI1PK: "VIEWING",
    GSI1SK: `${viewingAt}#${listingId}`
  })
} as const;

export const VIEWING_INDEX = "GSI1";
