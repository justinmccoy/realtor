import {
  adminAuth,
  apiHandler,
  dispatch,
  nowIso,
  publishAdminAction,
  publishEvents
} from "@jj/lambda-kit";
import {
  ApiError,
  EVENT_SOURCES,
  importRequestSchema,
  listingCreateSchema,
  type FieldProvenance,
  type ImportResult
} from "@jj/shared";
import { defaultDeps, runImport } from "../import/index.js";
import * as repo from "../repo.js";

/**
 * Link → draft listing. Runs in its own Lambda because one import chains a
 * page fetch (possibly via proxy) and an AI call; the admin route Lambda keeps
 * its short timeout. Photos are imported afterwards by the media service,
 * batch by batch, from the URLs returned here.
 */
export const handler = dispatch({
  "POST /api/v1/admin/import": apiHandler({
    body: importRequestSchema,
    fn: async ({ body, event }) => {
      const admin = adminAuth(event);
      const source = body.sourceId ? await repo.getSource(body.sourceId) : null;
      if (body.sourceId && !source) throw ApiError.notFound("Inbox link");
      const url = body.url ?? source?.url;

      let outcome;
      try {
        outcome = await runImport({ url, content: body.content }, defaultDeps());
      } catch (err) {
        if (source && err instanceof ApiError && err.code === "upstream_blocked") {
          await repo.updateSource(source.id, { status: "failed" });
        }
        throw err;
      }

      const input = listingCreateSchema.parse({
        ...outcome.fields,
        url: outcome.fields.url ?? url ?? null,
        published: false
      });
      const listing = await repo.createListing(input);
      if (source) {
        await repo.updateSource(source.id, { status: "done", listingId: listing.id });
      }

      const from = outcome.portal ? ` from ${outcome.portal}` : " from pasted text";
      await publishAdminAction(EVENT_SOURCES.listing, admin, {
        action: "import",
        entity: "listing",
        entityId: listing.id,
        listingId: listing.id,
        summary: `Imported "${listing.title}"${from} as a draft`,
        after: listing
      });
      await publishEvents(EVENT_SOURCES.listing, {
        type: "listing.created",
        listingId: listing.id,
        actorId: admin.userId,
        actorName: admin.displayName,
        actorRole: "admin",
        at: nowIso(),
        summary: `Listing "${listing.title}" imported as a draft`,
        payload: { title: listing.title, published: listing.published }
      });

      const result: ImportResult = {
        listing,
        provenance: outcome.provenance as Record<string, FieldProvenance>,
        photoUrls: outcome.photoUrls,
        warnings: outcome.warnings,
        fetchedVia: outcome.fetchedVia,
        portal: outcome.portal,
        aiUsed: outcome.aiUsed
      };
      return { status: 201, body: result };
    }
  })
});
