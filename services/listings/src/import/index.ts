import { logger } from "@jj/lambda-kit";
import {
  MAX_IMPORT_PHOTO_URLS,
  ORTSTEILE,
  type DistrictName,
  type ExtractableField,
  type ExtractedListing,
  type ImportFetchMode
} from "@jj/shared";
import { extractWithAi, type AiExtractInput, type AiExtractResult } from "./ai.js";
import { fetchListingPage, resolveFetchOptions, type FetchedPage } from "./fetchPage.js";
import { ortsteilDistrict } from "./geo.js";
import {
  extractImageUrls,
  extractJsonLd,
  extractMeta,
  htmlToText,
  looksLikeHtml
} from "./html.js";
import { parsePage, type Provenance } from "./parse.js";

export interface ImportInput {
  url?: string;
  /** Page HTML from the fetch step, or text the admin pasted. */
  content?: string;
  /** How the fetch step obtained `content`; unset means it was pasted. */
  fetchedVia?: "direct" | "proxy";
}

export interface ImportOutcome {
  fields: ExtractedListing;
  provenance: Provenance;
  photoUrls: string[];
  warnings: string[];
  fetchedVia: ImportFetchMode;
  portal: string | null;
  aiUsed: boolean;
}

/** Injectable so the orchestration is unit-testable without network or model. */
export interface ImportDeps {
  fetchPage: (url: string) => Promise<FetchedPage>;
  ai: (input: AiExtractInput) => Promise<AiExtractResult | null>;
  aiTimeoutMs: number;
}

export function defaultDeps(): ImportDeps {
  return {
    // Resolved per call: the proxy key comes from Secrets Manager (cached).
    fetchPage: async (url) => fetchListingPage(url, await resolveFetchOptions()),
    ai: extractWithAi,
    // Extraction runs in its own request now (the page arrives pre-fetched),
    // so the model gets most of the 30 s window.
    aiTimeoutMs: 22_000
  };
}

/** Fields where a page-parsed value should survive even when the AI answers;
 *  the rest prefer the model's reading of the page. */
const PAGE_WINS: ReadonlySet<ExtractableField> = new Set(["url"]);

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export async function runImport(input: ImportInput, deps: ImportDeps): Promise<ImportOutcome> {
  const warnings: string[] = [];
  let html: string;
  let text: string;
  let fetchedVia: ImportFetchMode;
  let pageUrl = input.url;

  if (input.content !== undefined) {
    fetchedVia = input.fetchedVia ?? "paste";
    if (looksLikeHtml(input.content)) {
      html = input.content;
      text = htmlToText(html);
    } else {
      html = "";
      text = input.content.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
    }
  } else if (input.url) {
    const page = await deps.fetchPage(input.url);
    fetchedVia = page.via;
    html = page.html;
    text = htmlToText(html);
    pageUrl = page.finalUrl || input.url;
    if (page.truncated) warnings.push("The page was very large; only the first part was read.");
  } else {
    throw new Error("runImport needs a url or content");
  }

  const meta = html ? extractMeta(html) : {};
  const jsonLd = html ? extractJsonLd(html) : [];
  const parsed = parsePage({ text, meta, jsonLd, url: pageUrl });
  const fields: ExtractedListing = { ...parsed.fields };
  const provenance: Provenance = { ...parsed.provenance };

  let aiUsed = false;
  if (text.length < 80) {
    warnings.push("Hardly any text was found on the page, so little could be extracted.");
  } else {
    try {
      const ai = await deps.ai({ text, url: pageUrl, timeoutMs: deps.aiTimeoutMs });
      if (ai === null) {
        warnings.push("AI extraction is not configured; only the page markup was parsed.");
      } else if (ai.problem) {
        warnings.push(`AI extraction skipped: ${ai.problem}.`);
      } else {
        aiUsed = true;
        if (ai.truncated) warnings.push("The page text was long; the AI only saw the first part.");
        for (const [k, v] of Object.entries(ai.fields) as [ExtractableField, unknown][]) {
          if (v === undefined || v === null) continue;
          if (PAGE_WINS.has(k) && fields[k] !== undefined) continue;
          (fields as Record<string, unknown>)[k] = v;
          provenance[k] = "ai";
        }
      }
    } catch (err) {
      logger.warn("ai extraction failed", { error: (err as Error).message });
      warnings.push("AI extraction failed; fields below come from the page markup only.");
    }
  }

  // Reconcile geography: an Ortsteil pins down its Bezirk.
  if (fields.ortsteil) {
    const owner = ortsteilDistrict(fields.ortsteil);
    if (!owner) {
      if (!fields.kiez) {
        fields.kiez = fields.ortsteil;
        provenance.kiez = provenance.ortsteil;
      }
      delete fields.ortsteil;
      delete provenance.ortsteil;
    } else if (fields.bezirk !== owner) {
      fields.bezirk = owner;
      provenance.bezirk = provenance.ortsteil;
    }
  }
  if (!fields.bezirk) {
    fields.bezirk = "Mitte" satisfies DistrictName;
    delete provenance.bezirk;
    warnings.push("District could not be detected — set it before saving.");
  } else if (fields.ortsteil && !ORTSTEILE[fields.bezirk].includes(fields.ortsteil)) {
    delete fields.ortsteil;
    delete provenance.ortsteil;
  }

  if (!fields.url && pageUrl) {
    fields.url = pageUrl;
    provenance.url = "page";
  }
  const portal = hostOf(fields.url ?? pageUrl);
  if (!fields.title) {
    fields.title = portal ? `Imported listing (${portal})` : "Imported listing";
    warnings.push("No title found — give the listing a name.");
  }
  if (fields.price === undefined) warnings.push("No purchase price found.");
  if (fields.sqm === undefined) warnings.push("No living area found.");

  const photoUrls = html ? extractImageUrls(html, meta, jsonLd, MAX_IMPORT_PHOTO_URLS) : [];
  if (!photoUrls.length) {
    warnings.push(
      fetchedVia === "paste" && !html
        ? "Pasted text carries no images — add photos manually."
        : "No photos found on the page."
    );
  }

  return { fields, provenance, photoUrls, warnings, fetchedVia, portal, aiUsed };
}
