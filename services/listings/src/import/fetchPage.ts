import { logger, safeFetch } from "@jj/lambda-kit";
import { ApiError } from "@jj/shared";
import { readSecretFromEnv } from "./secrets.js";

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
  /** Ready-to-use proxy URL template (key already substituted). */
  proxyTemplate?: string;
  /** A proxy template is configured but its API key secret is still unset. */
  proxyKeyMissing?: boolean;
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

/**
 * Fills `{key}` in a proxy template with the provider's API key. The key
 * never sits in cdk.json or a Lambda env var; it comes from Secrets Manager.
 * Returns undefined when the template needs a key that is not available.
 */
export function applyProxyKey(
  template: string | undefined,
  key: string | null
): string | undefined {
  const t = template?.trim();
  if (!t) return undefined;
  if (!t.includes("{key}")) return t;
  if (!key) return undefined;
  return t.replaceAll("{key}", encodeURIComponent(key));
}

/** Env: IMPORT_PROXY_URL_TEMPLATE, PROXY_SECRET_ARN, IMPORT_FETCH_MODE. */
export async function resolveFetchOptions(): Promise<FetchPageOptions> {
  const mode = process.env.IMPORT_FETCH_MODE;
  const template = process.env.IMPORT_PROXY_URL_TEMPLATE?.trim() || undefined;
  const key = template?.includes("{key}") ? await readSecretFromEnv("PROXY_SECRET_ARN") : null;
  const proxyTemplate = applyProxyKey(template, key);
  const proxyKeyMissing = Boolean(template && !proxyTemplate);
  if (proxyKeyMissing) {
    logger.warn("fetch proxy configured but its API key secret is still unset");
  }
  return {
    proxyTemplate,
    proxyKeyMissing,
    mode: mode === "direct" || mode === "proxy" ? mode : "auto"
  };
}

/** Portals that always wall off cloud IPs: when a proxy is configured, don't
 *  burn seconds on the direct attempt first. */
const KNOWN_BLOCKED = /(^|\.)(immobilienscout24\.de|immoscout24\.de|kleinanzeigen\.de|ebay-kleinanzeigen\.de)$/i;

/** Default budgets. The fetch runs in its own request (API Gateway allows
 *  30 s), so the proxy gets most of it: a JS-rendered page through
 *  residential proxies routinely takes 10–20 s. */
export const DIRECT_TIMEOUT_MS = 6_000;
export const PROXY_TIMEOUT_MS = 22_000;
export const PROXY_ONLY_TIMEOUT_MS = 27_000;

export async function fetchListingPage(
  url: string,
  opts: FetchPageOptions = {}
): Promise<FetchedPage> {
  const host = new URL(url).hostname;
  const proxy = opts.proxyTemplate;
  let mode = opts.mode ?? "auto";
  if (mode === "auto" && proxy && KNOWN_BLOCKED.test(host)) mode = "proxy";
  let directStatus: number | undefined;
  let directError: string | undefined;

  if (mode !== "proxy" || !proxy) {
    try {
      const res = await safeFetch(url, {
        timeoutMs: opts.directTimeoutMs ?? DIRECT_TIMEOUT_MS,
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
    const timeoutMs =
      opts.proxyTimeoutMs ?? (mode === "proxy" ? PROXY_ONLY_TIMEOUT_MS : PROXY_TIMEOUT_MS);
    let res;
    try {
      res = await safeFetch(proxied, {
        timeoutMs,
        maxBytes: MAX_PAGE_BYTES,
        onOverflow: "truncate",
        headers: { accept: BROWSER_HEADERS["accept"]! }
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 504) {
        throw new ApiError(
          504,
          "upstream_blocked",
          `The fetch proxy did not return ${host} within ${Math.round(timeoutMs / 1000)} s (it renders the page in a real browser, which can be slow). Try the import again, or paste the page text.`
        );
      }
      throw err;
    }
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
  const proxyHint = opts.proxyKeyMissing
    ? " A fetch proxy is configured but its API key has not been stored in Secrets Manager yet."
    : "";
  throw new ApiError(
    422,
    "upstream_blocked",
    `${host} refused the automated request (${why}).${proxyHint} Open the page in your browser, select all, copy, and paste the text here instead.`
  );
}
