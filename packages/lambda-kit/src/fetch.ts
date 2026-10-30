import { ApiError } from "@jj/shared";

/**
 * Outbound HTTP for Lambdas that fetch third-party pages and images on an
 * admin's behalf. Guards against the usual SSRF footguns (non-http schemes,
 * loopback / link-local / private address literals), enforces a timeout and
 * a byte cap, and maps network failures to the shared error format.
 */

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
  /** "error" (default) rejects oversized responses; "truncate" keeps the
   *  first `maxBytes` and flags it — fine for HTML, never for images. */
  onOverflow?: "error" | "truncate";
}

export interface SafeFetchResult {
  status: number;
  ok: boolean;
  /** URL after redirects. */
  finalUrl: string;
  contentType: string;
  body: Buffer;
  truncated: boolean;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "instance-data"
]);

function isPrivateIpv4(a: number, b: number): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host || BLOCKED_HOSTS.has(host)) return true;
  if (/\.(local|localhost|internal|lan|home|corp)$/.test(host)) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) return isPrivateIpv4(Number(v4[1]), Number(v4[2]));
  if (host.startsWith("[")) {
    const v6 = host.slice(1, -1);
    return (
      v6 === "::" ||
      v6 === "::1" ||
      v6.startsWith("fc") ||
      v6.startsWith("fd") ||
      v6.startsWith("fe80") ||
      v6.startsWith("::ffff:")
    );
  }
  return false;
}

/** Parses and validates a URL we are willing to fetch on the server. */
export function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw ApiError.badRequest(`Not a valid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw ApiError.badRequest("Only http(s) URLs can be fetched");
  }
  if (isPrivateHost(url.hostname)) {
    throw ApiError.badRequest("That address cannot be fetched");
  }
  return url;
}

export async function safeFetch(
  rawUrl: string,
  opts: SafeFetchOptions = {}
): Promise<SafeFetchResult> {
  const target = assertPublicHttpUrl(rawUrl);
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  try {
    const res = await fetch(target, {
      method: "GET",
      redirect: "follow",
      headers: opts.headers,
      signal: controller.signal
    });
    const finalUrl = res.url || target.href;
    // Redirect chains can land somewhere we would never have requested.
    assertPublicHttpUrl(finalUrl);

    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > maxBytes && opts.onOverflow !== "truncate") {
      await res.body?.cancel();
      throw new ApiError(
        413,
        "payload_too_large",
        `Response is ${declared} bytes; limit is ${maxBytes}`
      );
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = false;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          if (opts.onOverflow === "truncate") {
            const keep = value.byteLength - (total - maxBytes);
            chunks.push(value.subarray(0, keep));
            truncated = true;
            await reader.cancel();
            break;
          }
          await reader.cancel();
          throw new ApiError(
            413,
            "payload_too_large",
            `Response exceeds ${maxBytes} bytes`
          );
        }
        chunks.push(value);
      }
    }
    return {
      status: res.status,
      ok: res.ok,
      finalUrl,
      contentType: res.headers.get("content-type") ?? "",
      body: Buffer.concat(chunks),
      truncated
    };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const name = (err as { name?: string }).name;
    if (name === "AbortError" || name === "TimeoutError") {
      throw new ApiError(
        504,
        "upstream_blocked",
        `${target.hostname} did not respond in time`
      );
    }
    const cause = (err as { cause?: { message?: string } }).cause?.message;
    throw new ApiError(
      502,
      "upstream_blocked",
      `Could not reach ${target.hostname}${cause ? ` (${cause})` : ""}`
    );
  } finally {
    clearTimeout(timer);
  }
}
