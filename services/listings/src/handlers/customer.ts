import { z } from "zod";
import {
  apiHandler,
  customerAuth,
  dispatch,
  requireSearchAccess
} from "@jj/lambda-kit";
import { pageQuerySchema } from "@jj/shared";
import { paginateOffset, sortListings, toCustomerListing } from "../domain.js";
import * as repo from "../repo.js";

const searchPath = z.object({ searchId: z.string().ulid() });
const listQuery = pageQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(200).default(100)
});

/** Customers see published listings only, with admin-private fields removed.
 *  Photos/ratings are joined client-side; costs are computed client-side from
 *  the search settings (shared cost helpers), as the artifact did. */
export const handler = dispatch({
  "GET /api/v1/searches/{searchId}/listings": apiHandler({
    path: searchPath,
    query: listQuery,
    fn: async ({ path, query, event }) => {
      const auth = customerAuth(event);
      requireSearchAccess(auth, path.searchId);
      const published = (await repo.listAll(path.searchId)).filter(
        (l) => l.published
      );
      const sorted = sortListings(published, "new").map(toCustomerListing);
      return { body: paginateOffset(sorted, query.limit, query.cursor) };
    }
  })
});
