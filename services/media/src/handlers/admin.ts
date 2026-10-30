import { z } from "zod";
import {
  adminAuth,
  apiHandler,
  dispatch,
  logger,
  newId,
  nowIso,
  publishAdminAction,
  publishEvents
} from "@jj/lambda-kit";
import {
  ApiError,
  EVENT_SOURCES,
  MAX_PHOTO_BYTES,
  PHOTO_KINDS,
  photoImportSchema,
  photoReorderSchema,
  presignRequestSchema,
  type Photo,
  type PhotoImportItem,
  type PresignResponse
} from "@jj/shared";
import { downloadImage } from "../import.js";
import { photoS3Key } from "../keys.js";
import * as repo from "../repo.js";
import * as s3 from "../s3.js";

const listingPath = z.object({ listingId: z.string().ulid() });
const photoPath = listingPath.extend({ photoId: z.string().ulid() });
const reorderBody = photoReorderSchema.extend({
  kind: z.enum(PHOTO_KINDS).default("photo")
});

async function withUrl(p: Photo): Promise<Photo & { url: string }> {
  return { ...p, url: await s3.presignDownload(p.s3Key) };
}

export const handler = dispatch({
  "GET /api/v1/admin/listings/{listingId}/photos": apiHandler({
    path: listingPath,
    fn: async ({ path, event }) => {
      adminAuth(event);
      const photos = (await repo.listByListing(path.listingId)).filter(
        (p) => p.status === "ready"
      );
      return { body: { items: await Promise.all(photos.map(withUrl)) } };
    }
  }),

  /** Step 1 of an upload: reserve metadata + hand out a pre-signed PUT. */
  "POST /api/v1/admin/listings/{listingId}/photos/presign": apiHandler({
    path: listingPath,
    body: presignRequestSchema,
    fn: async ({ path, body, event }) => {
      adminAuth(event);
      const photoId = newId();
      const s3Key = photoS3Key(path.listingId, photoId, body.contentType);
      const photo: Photo = {
        id: photoId,
        listingId: path.listingId,
        kind: body.kind,
        s3Key,
        contentType: body.contentType,
        sortOrder: await repo.nextSortOrder(path.listingId),
        status: "pending",
        createdAt: nowIso()
      };
      await repo.putPhoto(photo);
      const { url, headers } = await s3.presignUpload(s3Key, body.contentType);
      const response: PresignResponse = {
        photoId,
        uploadUrl: url,
        headers,
        expiresInSeconds: s3.UPLOAD_EXPIRY_SECONDS
      };
      return { status: 201, body: response };
    }
  }),

  /** Step 2: after the browser PUT, verify the object and make it visible. */
  "POST /api/v1/admin/listings/{listingId}/photos/{photoId}/confirm": apiHandler({
    path: photoPath,
    fn: async ({ path, event }) => {
      const admin = adminAuth(event);
      const photo = await repo.requirePhoto(path.listingId, path.photoId);
      const head = await s3.headObject(photo.s3Key);
      if (!head) {
        throw ApiError.badRequest("Upload not found — PUT the file first");
      }
      if (head.size > MAX_PHOTO_BYTES) {
        await s3.deleteObject(photo.s3Key);
        await repo.deletePhoto(path.listingId, path.photoId);
        throw new ApiError(
          413,
          "payload_too_large",
          `Photo exceeds ${Math.round(MAX_PHOTO_BYTES / 1024 / 1024)} MB`
        );
      }
      const ready = await repo.markReady(path.listingId, path.photoId);
      await publishEvents(EVENT_SOURCES.media, {
        type: "photo.added",
        listingId: ready.listingId,
        actorId: admin.userId,
        actorName: admin.displayName,
        actorRole: "admin",
        at: nowIso(),
        summary: `${ready.kind === "floorplan" ? "Floor plan" : "Photo"} added`
      });
      return { body: await withUrl(ready) };
    }
  }),

  /** Listing import: download photos from the source page straight into the
   *  bucket. Downloads run in parallel so a batch stays inside the API
   *  Gateway timeout; each URL reports success or failure individually. */
  "POST /api/v1/admin/listings/{listingId}/photos/import": apiHandler({
    path: listingPath,
    body: photoImportSchema,
    fn: async ({ path, body, event }) => {
      const admin = adminAuth(event);
      const base = await repo.nextSortOrder(path.listingId);
      const settled = await Promise.allSettled(
        body.urls.map(async (url, i): Promise<Photo> => {
          const { body: bytes, contentType } = await downloadImage(url);
          const photoId = newId();
          const s3Key = photoS3Key(path.listingId, photoId, contentType);
          await s3.putObject(s3Key, bytes, contentType);
          const photo: Photo = {
            id: photoId,
            listingId: path.listingId,
            kind: body.kind,
            s3Key,
            contentType,
            sortOrder: base + i,
            status: "ready",
            createdAt: nowIso()
          };
          await repo.putPhoto(photo);
          return photo;
        })
      );
      const items: PhotoImportItem[] = [];
      for (const [i, outcome] of settled.entries()) {
        const url = body.urls[i]!;
        if (outcome.status === "fulfilled") {
          items.push({ url, ok: true, photo: await withUrl(outcome.value) });
        } else {
          const err = outcome.reason as Error;
          logger.warn("photo import failed", { url, error: err.message });
          items.push({
            url,
            ok: false,
            error: err instanceof ApiError ? err.message : "Download failed"
          });
        }
      }
      const okCount = items.filter((i) => i.ok).length;
      if (okCount > 0) {
        const noun = body.kind === "floorplan" ? "floor plan" : "photo";
        await publishAdminAction(EVENT_SOURCES.media, admin, {
          action: "import-photos",
          entity: "photo",
          entityId: path.listingId,
          listingId: path.listingId,
          summary: `Imported ${okCount} ${noun}${okCount === 1 ? "" : "s"} from the source page`
        });
        await publishEvents(EVENT_SOURCES.media, {
          type: "photo.added",
          listingId: path.listingId,
          actorId: admin.userId,
          actorName: admin.displayName,
          actorRole: "admin",
          at: nowIso(),
          summary: `${okCount} ${noun}${okCount === 1 ? "" : "s"} imported`
        });
      }
      return { body: { items } };
    }
  }),

  "PATCH /api/v1/admin/listings/{listingId}/photos/order": apiHandler({
    path: listingPath,
    body: reorderBody,
    fn: async ({ path, body, event }) => {
      const admin = adminAuth(event);
      const updated = await repo.reorder(path.listingId, body.kind, body.orderedIds);
      await publishAdminAction(EVENT_SOURCES.media, admin, {
        action: "reorder-photos",
        entity: "photo",
        entityId: path.listingId,
        listingId: path.listingId,
        summary: `Reordered ${body.kind}s`
      });
      return { body: { items: updated } };
    }
  }),

  "DELETE /api/v1/admin/listings/{listingId}/photos/{photoId}": apiHandler({
    path: photoPath,
    fn: async ({ path, event }) => {
      const admin = adminAuth(event);
      const photo = await repo.requirePhoto(path.listingId, path.photoId);
      await repo.deletePhoto(path.listingId, path.photoId);
      await s3.deleteObject(photo.s3Key);
      await publishAdminAction(EVENT_SOURCES.media, admin, {
        action: "delete",
        entity: "photo",
        entityId: photo.id,
        listingId: photo.listingId,
        summary: `Deleted a ${photo.kind}`
      });
      await publishEvents(EVENT_SOURCES.media, {
        type: "photo.deleted",
        listingId: photo.listingId,
        actorId: admin.userId,
        actorName: admin.displayName,
        actorRole: "admin",
        at: nowIso(),
        summary: `${photo.kind === "floorplan" ? "Floor plan" : "Photo"} deleted`
      });
      return { status: 204 };
    }
  })
});
