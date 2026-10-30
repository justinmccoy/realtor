import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let client: S3Client | undefined;

function s3(): S3Client {
  if (!client) {
    client = new S3Client(
      process.env.S3_ENDPOINT
        ? {
            endpoint: process.env.S3_ENDPOINT,
            forcePathStyle: true,
            region: process.env.AWS_REGION ?? "eu-central-1",
            credentials: { accessKeyId: "local", secretAccessKey: "local" }
          }
        : {}
    );
  }
  return client;
}

function bucket(): string {
  const b = process.env.MEDIA_BUCKET;
  if (!b) throw new Error("MEDIA_BUCKET not set");
  return b;
}

export const UPLOAD_EXPIRY_SECONDS = 900;
export const DOWNLOAD_EXPIRY_SECONDS = 3600;

export async function presignUpload(
  key: string,
  contentType: string
): Promise<{ url: string; headers: Record<string, string> }> {
  const url = await getSignedUrl(
    s3(),
    new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }),
    { expiresIn: UPLOAD_EXPIRY_SECONDS }
  );
  return { url, headers: { "content-type": contentType } };
}

export async function presignDownload(key: string): Promise<string> {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
    { expiresIn: DOWNLOAD_EXPIRY_SECONDS }
  );
}

/** Returns null when the object does not exist. */
export async function headObject(
  key: string
): Promise<{ size: number; contentType?: string } | null> {
  try {
    const res = await s3().send(
      new HeadObjectCommand({ Bucket: bucket(), Key: key })
    );
    return { size: res.ContentLength ?? 0, contentType: res.ContentType };
  } catch (err) {
    if (
      err instanceof NotFound ||
      (err as { name?: string }).name === "NotFound" ||
      (err as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode === 404
    ) {
      return null;
    }
    throw err;
  }
}

/** Server-side write (imports); browser uploads go through presignUpload. */
export async function putObject(
  key: string,
  body: Uint8Array,
  contentType: string
): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: contentType
    })
  );
}

export async function deleteObject(key: string): Promise<void> {
  await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

export async function deleteObjectsBatch(keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    if (!chunk.length) return;
    await s3().send(
      new DeleteObjectsCommand({
        Bucket: bucket(),
        Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true }
      })
    );
  }
}
