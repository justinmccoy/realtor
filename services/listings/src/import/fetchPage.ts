import { safeFetch } from "@jj/lambda-kit";
import { ApiError } from "@jj/shared";

/**
 * Fetches a portal page. Direct requests from AWS address space are refused
 * by the big German portals (bot walls, captchas), so when a scraping proxy
 * is configured we fall back to it. The proxy is a URL template with `{url}`
 * where the encoded target goes — that shape covers the common providers
 * without vendor-specific code.
 *
 * Env: IMPORT_PROXY_URL_TEMPLATE, IMPORT_FETCH_MODE (auto | direct | proxy)
 */

export interface FetchedPage {
  html: string;
  finalUrl: string;
  via: "direct" | "proxy";
  truncated: boolean;
}

export interface FetchPageOptions {
  proxyTemplate?: string;
  mode?: "auto" | "direct" | "proxy";
  directTimeoutMs?: number;
  proxyTimeoutMs?: number;
}

export const MAX_PAGE_BYTES = 4 * 1024 * 1024;

const BROWSER_HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "de-DE,de;q=0.9,en;q=0.7",
  "upgrade-insecure-requests": "1"
};

const BOT_WALL =
  /captcha|are you a robot|ich bin kein roboter|access denied|zugriff verweigert|just a moment|attention required|bot detection|unusual traffic|verify you are human|security check|pardon our interruption|request blocked|akamai|cf-chl/i;

/** Heuristic: the portal answered, but not with the listing. */
export function looksLikeBotWall(status: number, html: string): boolean {
  if (status === 403 || status === 429 || status === 503) return true;
  if (status >= 400) return false;
  const head = html.slice(0, 30_000);
  return BOT_WALL.test(head) && html.length < 80_000;
}

export function fetchOptionsFromEnv(): FetchPageOptions {
  const mode = process.env.IMPORT_FETCH_MODE;
  return {
    proxyTemplate: process.env.IMPORT_PROXY_URL_TEMPLATE?.trim() || undefined,
    mode: mode === "direct" || mode === "proxy" ? mode : "auto"
  };
}

export async function fetchListingPage(
  url: string,
  opts: FetchPageOptions = {}
): Promise<FetchedPage> {
  const host = new URL(url).hostname;
  const mode = opts.mode ?? "auto";
  const proxy = opts.proxyTemplate;
  let directStatus: number | undefined;
  let directError: string | undefined;

  if (mode !== "proxy" || !proxy) {
    try {
      const res = await safeFetch(url, {
        timeoutMs: opts.directTimeoutMs ?? 7_000,
        maxBytes: MAX_PAGE_BYTES,
        onOverflow: "truncate",
        headers: BROWSER_HEADERS
      });
      const html = res.body.toString("utf8");
      if (res.ok && !looksLikeBotWall(res.status, html)) {
        return { html, finalUrl: res.finalUrl, via: "direct", truncated: res.truncated };
      }
      directStatus = res.status;
    } catch (err) {
      if (err instanceof ApiError && err.code === "upstream_blocked") {
        directError = err.message;
      } else {
        throw err;
      }
    }
  }

  if (proxy && mode !== "direct") {
    const proxied = proxy.includes("{url}")
      ? proxy.replace("{url}", encodeURIComponent(url))
      : `${proxy}${proxy.includes("?") ? "&" : "?"}url=${encodeURIComponent(url)}`;
    const res = await safeFetch(proxied, {
      timeoutMs: opts.proxyTimeoutMs ?? 14_000,
      maxBytes: MAX_PAGE_BYTES,
      onOverflow: "truncate",
      headers: { accept: BROWSER_HEADERS["accept"]! }
    });
    const html = res.body.toString("utf8");
    if (res.ok && html.length > 500) {
      return { html, finalUrl: url, via: "proxy", truncated: res.truncated };
    }
    throw new ApiError(
      422,
      "upstream_blocked",
      `The fetch proxy could not load ${host} (HTTP ${res.status}). Paste the page text instead.`
    );
  }

  const why =
    directStatus !== undefined
      ? `HTTP ${directStatus}`
      : directError ?? "no response";
  throw new ApiError(
    422,
    "upstream_blocked",
    `${host} refused the automated request (${why}). Open the page in your browser, select all, copy, and paste the text here instead.`
  );
}
