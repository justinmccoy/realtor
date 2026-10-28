/** Key layout for engagement-table (ratings + comments).
 *
 *  RATING:        PK LISTING#<lid> / SK RATING#<userId>
 *                 GSI1PK SEARCH#<sid> / GSI1SK RATING#<lid>#<userId>
 *  COMMENT:       PK SEARCH#<sid> / SK COMMENT#<cid>   (cid = ULID → time-ordered)
 *  LISTING META:  PK LISTING#<lid> / SK META
 *    — event-carried state from the listing service ({searchId, title,
 *      published}); used to validate that a listing belongs to the search a
 *      customer is writing into, without cross-service table reads. */
export const engagementKeys = {
  rating: (listingId: string, userId: string) => ({
    PK: `LISTING#${listingId}`,
    SK: `RATING#${userId}`
  }),
  ratingGsi: (searchId: string, listingId: string, userId: string) => ({
    GSI1PK: `SEARCH#${searchId}`,
    GSI1SK: `RATING#${listingId}#${userId}`
  }),
  comment: (searchId: string, commentId: string) => ({
    PK: `SEARCH#${searchId}`,
    SK: `COMMENT#${commentId}`
  }),
  listingMeta: (listingId: string) => ({
    PK: `LISTING#${listingId}`,
    SK: "META"
  })
} as const;

export const SEARCH_RATINGS_INDEX = "GSI1";

export interface ListingMeta {
  searchId: string;
  title: string;
  published: boolean;
}
