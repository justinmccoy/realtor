import { z } from "zod";
import {
  apiHandler,
  customerAuth,
  dispatch,
  requireSearchAccess
} from "@jj/lambda-kit";
import type { Photo } from "@jj/shared";
import * as repo from "../repo.js";
import * as s3 from "../s3.js";

const searchPath = z.object({ searchId: z.string().ulid() });
const listQuery = z.object({
  /** Comma-separated listing ids — the visible set the client already holds
   *  from the listings endpoint. ULIDs are unguessable; active-flag filtering
   *  below is the hard gate. */
  ids: z
    .string()
    .min(1)
    .max(4000)
    .transform((v) => v.split(",").filter(Boolean))
    .pipe(z.array(z.string().ulid()).min(1).max(120))
});

export const handler = dispatch({
  "GET /api/v1/searches/{searchId}/photos": apiHandler({
    path: searchPath,
    query: listQuery,
    fn: async ({ path, query, event }) => {
      const auth = customerAuth(event);
      requireSearchAccess(auth, path.searchId);
      const active = await repo.publishedMap(query.ids);
      const photos: Photo[] = [];
      for (const id of query.ids) {
        if (!active[id]) continue;
        photos.push(
          ...(await repo.listByListing(id)).filter((p) => p.status === "ready")
        );
      }
      const items = await Promise.all(
        photos.map(async (p) => ({ ...p, url: await s3.presignDownload(p.s3Key) }))
      );
      return { body: { items, nextCursor: null } };
    }
  })
});
