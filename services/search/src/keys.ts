/** Key layout for search-table. The search service is the only reader/writer,
 *  with one sanctioned exception: the customer Lambda authorizer (also owned
 *  by this service, deployed by the API stack) queries GSI1 for memberships. */
export const searchKeys = {
  search: (searchId: string) => ({ PK: `SEARCH#${searchId}`, SK: "META" }),
  brief: (searchId: string) => ({ PK: `SEARCH#${searchId}`, SK: "BRIEF" }),
  member: (searchId: string, userId: string) => ({
    PK: `SEARCH#${searchId}`,
    SK: `MEMBER#${userId}`
  }),
  memberGsi: (userId: string, searchId: string) => ({
    GSI1PK: `USER#${userId}`,
    GSI1SK: `SEARCH#${searchId}`
  }),
  /** GSI1 is also used to list all searches (admin): GSI1PK = "SEARCH". */
  searchListGsi: (searchId: string) => ({
    GSI1PK: "SEARCH",
    GSI1SK: `SEARCH#${searchId}`
  })
} as const;

export const MEMBERSHIP_INDEX = "GSI1";
