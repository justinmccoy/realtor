import { z } from "zod";
import {
  apiHandler,
  customerAuth,
  dispatch,
  requireSearchAccess
} from "@jj/lambda-kit";
import { pageQuerySchema, paginateOffset } from "@jj/shared";
import * as repo from "../repo.js";
import * as s3 from "../s3.js";

const searchPath = z.object({ searchId: z.string().ulid() });
const listQuery = pageQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(500).default(500)
});

/** Gallery data for the customer app: ready photos of published listings
 *  only, with time-limited download URLs. Joined to listings client-side. */
export const handler = dispatch({
  "GET /api/v1/searches/{searchId}/photos": apiHandler({
    path: searchPath,
    query: listQuery,
    fn: async ({ path, query, event }) => {
      const auth = customerAuth(event);
      requireSearchAccess(auth, path.searchId);
      const ready = (await repo.listBySearch(path.searchId)).filter(
        (p) => p.status === "ready"
      );
      const visible = await repo.publishedMap(ready.map((p) => p.listingId));
      const photos = ready.filter((p) => visible[p.listingId]);
      const page = paginateOffset(photos, query.limit, query.cursor);
      const items = await Promise.all(
        page.items.map(async (p) => ({
          ...p,
          url: await s3.presignDownload(p.s3Key)
        }))
      );
      return { body: { items, nextCursor: page.nextCursor } };
    }
  })
});
