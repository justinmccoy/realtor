import { z } from "zod";
import {
  apiHandler,
  customerAuth,
  dispatch,
  requireSearchAccess
} from "@jj/lambda-kit";
import { pageQuerySchema, paginateOffset } from "@jj/shared";
import { sortEntries } from "../domain.js";
import * as repo from "../repo.js";

const searchPath = z.object({ searchId: z.string().ulid() });
const listQuery = pageQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(500).default(200)
});

/** Read-only hours ledger for the client, exactly as the artifact showed it:
 *  entries with paid/outstanding flags; the client app groups by month and
 *  prices with the search's hourly rate. */
export const handler = dispatch({
  "GET /api/v1/searches/{searchId}/hours": apiHandler({
    path: searchPath,
    query: listQuery,
    fn: async ({ path, query, event }) => {
      const auth = customerAuth(event);
      requireSearchAccess(auth, path.searchId);
      const entries = sortEntries(await repo.listEntries(path.searchId));
      return { body: paginateOffset(entries, query.limit, query.cursor) };
    }
  })
});
