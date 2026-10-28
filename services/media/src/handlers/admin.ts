import { z } from "zod";
import {
  adminAuth,
  apiHandler,
  dispatch,
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
  photoReorderSchema,
  presignRequestSchema,
  type Photo,
  type PresignResponse
} from "@jj/shared";
import { photoS3Key } from "../keys.js";
import * as repo from "../repo.js";
import * as s3 from "../s3.js";

const searchPath = z.object({ searchId: z.string().ulid() });
const listingPath = z.object({
  searchId: z.string().ulid(),
  listingId: z.string().ulid()
});
const photoPath = listingPath.extend({ photoId: z.string().ulid() });
const reorderBody = photoReorderSchema.extend({
  kind: z.enum(PHOTO_KINDS).default("photo")
});

async function withUrl(p: Photo): Promise<Photo & { url: string }> {
  return { ...p, url: await s3.presignDownload(p.s3Key) };
}

export const handler = dispatch({
  /** Step 1 of an upload: reserve metadata + hand out a pre-signed PUT. */
  "POST /api/v1/admin/searches/{searchId}/listings/{listingId}/photos/presign":
    apiHandler({
      path: listingPath,
      body: presignRequestSchema,
      fn: async ({ path, body, event }) => {
        adminAuth(event);
        const photoId = newId();
        const s3Key = photoS3Key(
          path.searchId,
          path.listingId,
          photoId,
          body.contentType
        );
        const photo: Photo = {
          id: photoId,
          listingId: path.listingId,
          searchId: path.searchId,
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
  "POST /api/v1/admin/searches/{searchId}/listings/{listingId}/photos/{photoId}/confirm":
    apiHandler({
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
          searchId: ready.searchId,
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

  "GET /api/v1/admin/searches/{searchId}/photos": apiHandler({
    path: searchPath,
    fn: async ({ path, event }) => {
      adminAuth(event);
      const photos = (await repo.listBySearch(path.searchId)).filter(
        (p) => p.status === "ready"
      );
      return { body: { items: await Promise.all(photos.map(withUrl)) } };
    }
  }),

  "PATCH /api/v1/admin/searches/{searchId}/listings/{listingId}/photos/order":
    apiHandler({
      path: listingPath,
      body: reorderBody,
      fn: async ({ path, body, event }) => {
        const admin = adminAuth(event);
        const updated = await repo.reorder(
          path.listingId,
          body.kind,
          body.orderedIds
        );
        await publishAdminAction(EVENT_SOURCES.media, admin, {
          action: "reorder-photos",
          entity: "photo",
          entityId: path.listingId,
          searchId: path.searchId,
          listingId: path.listingId,
          summary: `Reordered ${body.kind}s`
        });
        return { body: { items: updated } };
      }
    }),

  "DELETE /api/v1/admin/searches/{searchId}/listings/{listingId}/photos/{photoId}":
    apiHandler({
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
          searchId: photo.searchId,
          listingId: photo.listingId,
          summary: `Deleted a ${photo.kind}`
        });
        await publishEvents(EVENT_SOURCES.media, {
          type: "photo.deleted",
          searchId: photo.searchId,
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
