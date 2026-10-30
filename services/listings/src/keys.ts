/** Key layout for listing-table (owned exclusively by the listing service).
 *
 *  Global pool (listings have no owning search):
 *    POOL            / LISTING#<lid>      the listings themselves
 *    POOL            / SOURCE#<srcId>     the link inbox
 *  Background link imports (TTL'd, never listed):
 *    IMPORTJOB#<jobId> / JOB
 *  Per-search visibility + matching state:
 *    SEARCH#<sid>    / SHARE#<lid>        manual share/hide override
 *    SEARCH#<sid>    / CRITERIA           event-carried copy of brief+settings
 *  GSI1 is a sparse "upcoming viewings" index: keys exist only while a
 *  listing has a viewing date set. */
export const listingKeys = {
  listing: (listingId: string) => ({ PK: "POOL", SK: `LISTING#${listingId}` }),
  source: (sourceId: string) => ({ PK: "POOL", SK: `SOURCE#${sourceId}` }),
  importJob: (jobId: string) => ({ PK: `IMPORTJOB#${jobId}`, SK: "JOB" }),
  share: (searchId: string, listingId: string) => ({
    PK: `SEARCH#${searchId}`,
    SK: `SHARE#${listingId}`
  }),
  criteria: (searchId: string) => ({ PK: `SEARCH#${searchId}`, SK: "CRITERIA" }),
  viewingGsi: (viewingAt: string, listingId: string) => ({
    GSI1PK: "VIEWING",
    GSI1SK: `${viewingAt}#${listingId}`
  })
} as const;

export const VIEWING_INDEX = "GSI1";
