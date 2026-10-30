import { safeFetch } from "@jj/lambda-kit";
import { ApiError, MAX_PHOTO_BYTES } from "@jj/shared";

export type ImageType = "image/jpeg" | "image/png" | "image/webp";

/** Content-type by magic bytes — image hosts lie or omit the header. */
export function sniffImageType(buf: Uint8Array): ImageType | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "image/png";
  }
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/** Downloads one image from a portal CDN, enforcing the upload size cap and
 *  the allowed formats. Sends the portal's origin as Referer because several
 *  image hosts refuse hot-linked requests without one. */
export async function downloadImage(
  url: string,
  timeoutMs = 8_000
): Promise<{ body: Buffer; contentType: ImageType }> {
  const referer = `${new URL(url).origin}/`;
  const res = await safeFetch(url, {
    timeoutMs,
    maxBytes: MAX_PHOTO_BYTES,
    headers: {
      accept: "image/webp,image/jpeg,image/png,image/*;q=0.8",
      referer,
      "user-agent": UA
    }
  });
  if (!res.ok) {
    throw new ApiError(422, "upstream_blocked", `Image host answered HTTP ${res.status}`);
  }
  const contentType = sniffImageType(res.body);
  if (!contentType) throw ApiError.badRequest("Not a JPEG, PNG or WebP image");
  return { body: res.body, contentType };
}
