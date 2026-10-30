import {
  extractedListingSchema,
  type ExtractableField,
  type ExtractedListing,
  type FieldProvenance
} from "@jj/shared";
import { detectLocation } from "./geo.js";

export type Provenance = Partial<Record<ExtractableField, FieldProvenance>>;

export interface PageInput {
  text: string;
  meta: Record<string, string>;
  jsonLd: Record<string, unknown>[];
  url?: string;
}

export interface ParsedPage {
  fields: ExtractedListing;
  provenance: Provenance;
}

/** "489.000,50" → 489000.5 · "78,5" → 78.5 · "1.200" → 1200 · "3,57" → 3.57 */
export function parseGermanNumber(raw: string): number | null {
  let s = raw.replace(/[\s€]|m²|m2|qm/g, "");
  if (!s) return null;
  const comma = s.includes(",");
  const dot = s.includes(".");
  if (comma && dot) {
    s =
      s.lastIndexOf(",") > s.lastIndexOf(".")
        ? s.replace(/\./g, "").replace(",", ".")
        : s.replace(/,/g, "");
  } else if (comma) {
    s = s.replace(",", ".");
  } else if (dot && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const NUM = "(\\d{1,3}(?:[.\\s]\\d{3})+(?:,\\d+)?|\\d+(?:[.,]\\d+)?)";

/** "Label[: ] [ca.] 123,45 unit" anywhere in the text. */
function labelled(
  text: string,
  labels: string[],
  unit = "",
  range?: [number, number]
): number | undefined {
  for (const label of labels) {
    const re = new RegExp(
      `${label}\\s*(?:\\(ca\\.\\)|ca\\.|circa|ab|von)?\\s*:?\\s*(?:ca\\.\\s*)?${NUM}\\s*${unit}`,
      "i"
    );
    const m = re.exec(text);
    if (!m) continue;
    const n = parseGermanNumber(m[1] ?? "");
    if (n === null) continue;
    if (range && (n < range[0] || n > range[1])) continue;
    return n;
  }
  return undefined;
}

function ldValue(jsonLd: Record<string, unknown>[], ...keys: string[]): unknown {
  for (const obj of jsonLd) {
    let cur: unknown = obj;
    for (const k of keys) {
      if (!cur || typeof cur !== "object") {
        cur = undefined;
        break;
      }
      cur = (cur as Record<string, unknown>)[k];
    }
    if (Array.isArray(cur)) cur = cur[0];
    if (cur !== undefined && cur !== null && cur !== "") return cur;
  }
  return undefined;
}

const PORTAL_SUFFIX =
  /\s*[|–-]\s*(immobilienscout24|immoscout24|immowelt|immonet|kleinanzeigen|ebay kleinanzeigen|engel\s*&\s*völkers|ohne-makler|wohnungsboerse|homeday|mcmakler)[^|–-]*$/i;

export function cleanTitle(raw: string): string {
  let t = raw.replace(/\s+/g, " ").trim();
  t = t.replace(PORTAL_SUFFIX, "");
  t = t.replace(/\s*\|\s*.*$/, "");
  t = t.replace(/\s+in\s+Berlin\s*-\s*[\p{L}\- ]+$/u, "");
  return t.slice(0, 200).trim();
}

/** Text of the "Objektbeschreibung" block, when the page has one. */
function descriptionSection(text: string): string | undefined {
  const m = /Objektbeschreibung\s*:?\s*\n([\s\S]{40,3000}?)(?:\n(?:Ausstattung|Lage|Sonstiges|Weitere Informationen|Energie|Preise|Kontakt|Anbieter|Ähnliche)\b|$)/i.exec(
    text
  );
  return m?.[1]?.trim();
}

function floorText(text: string): string | undefined {
  const m = /\b(?:Etage|Geschoss|Stockwerk)\s*:?\s*([^\n]{1,40})/i.exec(text);
  if (m?.[1]) {
    const v = m[1].trim().replace(/\s+/g, " ");
    // Portal tables often continue on the same line; keep the leading value.
    return v.split(/\s{2,}|\s(?=[A-ZÄÖÜ][a-zäöüß]+\s*:)/)[0]?.slice(0, 50);
  }
  const word = /\b(Erdgeschoss|Hochparterre|Dachgeschoss|Souterrain|Penthouse)\b/i.exec(text);
  return word?.[1];
}

function streetFromText(text: string): string | undefined {
  const m =
    /(?<![\p{L}])([A-ZÄÖÜ][\p{L}\-.]+(?:\s[\p{L}\-.]+){0,2}?(?:straße|strasse|str\.|allee|platz|weg|damm|ufer|chaussee|promenade|ring|gasse|steig|zeile|markt))\s*(\d{1,4}\s?[a-zA-Z]?)?(?=[\s,])/u.exec(
      text
    );
  if (!m) return undefined;
  return [m[1], m[2]?.trim()].filter(Boolean).join(" ").slice(0, 200);
}

/** Deterministic extraction from page markup and text. */
export function parsePage(input: PageInput): ParsedPage {
  const { text, meta, jsonLd } = input;
  const fields: ExtractedListing = {};
  const provenance: Provenance = {};
  const set = <K extends ExtractableField>(k: K, v: ExtractedListing[K] | undefined) => {
    if (v === undefined || v === null || v === "") return;
    const parsed = extractedListingSchema.shape[k].safeParse(v);
    if (!parsed.success) return;
    (fields as Record<string, unknown>)[k] = parsed.data;
    provenance[k] = "page";
  };

  const ldTitle = ldValue(jsonLd, "name");
  const rawTitle =
    (typeof ldTitle === "string" && ldTitle) || meta["og:title"] || meta["title"];
  if (rawTitle) set("title", cleanTitle(rawTitle));

  const canonical = meta["canonical"];
  if (canonical && /^https?:\/\//i.test(canonical)) set("url", canonical);
  else if (input.url) set("url", input.url);

  const ldPrice = ldValue(jsonLd, "offers", "price");
  const price =
    typeof ldPrice === "number"
      ? ldPrice
      : typeof ldPrice === "string"
        ? parseGermanNumber(ldPrice)
        : labelled(text, ["Kaufpreis", "Preis(?!\\s*(?:pro|je|/)\\s*m)"], "€", [10_000, 100_000_000]);
  set("price", price ?? undefined);

  set("sqm", labelled(text, ["Wohnfläche", "Fläche"], "(?:m²|m2|qm)", [10, 5000]));
  set(
    "rooms",
    labelled(text, ["Zimmer(?:anzahl)?", "Anzahl\\s+Zimmer", "Zi\\."], "", [1, 30]) ??
      (() => {
        const m = new RegExp(`${NUM}\\s*[-\\s]?Zimmer`, "i").exec(text);
        const n = m ? parseGermanNumber(m[1] ?? "") : null;
        return n !== null && n >= 1 && n <= 30 ? n : undefined;
      })()
  );
  set("beds", labelled(text, ["Schlafzimmer"], "", [0, 20]));
  set("baths", labelled(text, ["Badezimmer", "Anzahl\\s+Bäder", "Bäder"], "", [0.5, 10]));
  set("floor", floorText(text));

  const year = /\bBaujahr\s*:?\s*(1[5-9]\d{2}|20\d{2})\b/i.exec(text);
  if (year) set("year", year[1]);

  set("hausgeld", labelled(text, ["Hausgeld", "Wohngeld"], "€", [10, 100_000]));

  if (/provisionsfrei|keine\s+(?:käufer)?provision|ohne\s+(?:käufer)?provision|provision\s*:?\s*nein/i.test(text)) {
    set("provision", 0);
  } else {
    const prov = /(?:käufer)?provision\s*(?:für\s+(?:den\s+)?käufer)?\s*:?\s*(\d+(?:[.,]\d+)?)\s*%/i.exec(text);
    const n = prov ? parseGermanNumber(prov[1] ?? "") : null;
    if (n !== null && n >= 0 && n <= 10) set("provision", n);
  }

  if (/kein(?:en)?\s+balkon/i.test(text)) {
    set("balcony", "no");
  } else {
    const words = new Set<string>();
    for (const m of text.matchAll(/\b(Balkon|Loggia|Dachterrasse|Terrasse|Wintergarten)\b/gi)) {
      const w = m[1] ?? "";
      words.add(w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    }
    if (words.size) {
      set("balcony", "yes");
      set("balconyNote", [...words].join(" · "));
    }
  }

  const loc = detectLocation(text);
  if (loc.bezirk) set("bezirk", loc.bezirk);
  if (loc.ortsteil) set("ortsteil", loc.ortsteil);

  const street = ldValue(jsonLd, "address", "streetAddress");
  set("kiez", typeof street === "string" ? street.trim() : streetFromText(text));

  const ldDesc = ldValue(jsonLd, "description");
  const desc =
    (typeof ldDesc === "string" && ldDesc) || meta["og:description"] || meta["description"];
  const section = descriptionSection(text);
  const notes = [desc?.replace(/\s+/g, " ").trim(), section]
    .filter((s): s is string => Boolean(s))
    .filter((s, i, arr) => arr.findIndex((o) => o.startsWith(s.slice(0, 80))) === i)
    .join("\n\n");
  if (notes) set("notes", notes.slice(0, 6000));

  return { fields, provenance };
}
