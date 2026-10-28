import {
  apiHandler,
  customerAuth,
  dispatch,
  newId,
  requireSearchAccess
} from "@jj/lambda-kit";
import { clientEventsBatchSchema } from "@jj/shared";
import { clientEventSummary, rollupField } from "../domain.js";
import * as repo from "../repo.js";

/**
 * Client interaction tracking: customer-web batches UI events (card expands,
 * photo views, exposé/map clicks, tab views) and posts them here. Each event
 * is written to the activity feed; listing-scoped ones also bump the
 * per-listing engagement rollup the admin dashboard reads.
 */
export const handler = dispatch({
  "POST /api/v1/activity/events": apiHandler({
    body: clientEventsBatchSchema,
    fn: async ({ body, event }) => {
      const auth = customerAuth(event);
      const role = requireSearchAccess(auth, body.searchId);
      let accepted = 0;
      for (const e of body.events) {
        await repo.putActivity({
          id: newId(),
          searchId: body.searchId,
          listingId: e.listingId ?? null,
          type: `client.${e.type}`,
          actorId: auth.userId,
          actorName: auth.displayName,
          actorRole: role,
          summary: clientEventSummary(auth.displayName, e.type),
          at: e.at,
          payload: e.meta ?? null
        });
        const field = rollupField(e.type);
        if (field && e.listingId) {
          await repo.bumpRollup(body.searchId, e.listingId, field, e.at);
        }
        accepted++;
      }
      return { status: 202, body: { accepted } };
    }
  })
});
