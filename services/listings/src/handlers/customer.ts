import { z } from "zod";
import {
  apiHandler,
  customerAuth,
  dispatch,
  requireSearchAccess
} from "@jj/lambda-kit";
import { pageQuerySchema, paginateOffset } from "@jj/shared";
import { sortCustomerCards, toCustomerListing } from "../domain.js";
import * as repo from "../repo.js";

const searchPath = z.object({ searchId: z.string().ulid() });
const listQuery = pageQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(200).default(100)
});

/**
 * Customers see the listings visible to their search: active listings that
 * match their brief (live) plus manual shares, minus manual hides — with
 * admin-private fields removed. Photos/ratings join client-side; costs are
 * computed client-side from the search settings, as the artifact did.
 */
export const handler = dispatch({
  "GET /api/v1/searches/{searchId}/listings": apiHandler({
    path: searchPath,
    query: listQuery,
    fn: async ({ path, query, event }) => {
      const auth = customerAuth(event);
      requireSearchAccess(auth, path.searchId);
      const visible = await repo.visibleForSearch(path.searchId);
      const sorted = sortCustomerCards(visible.map((v) => v.listing)).map(
        toCustomerListing
      );
      return { body: paginateOffset(sorted, query.limit, query.cursor) };
    }
  })
});
