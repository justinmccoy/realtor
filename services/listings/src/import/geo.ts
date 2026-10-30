import {
  DISTRICT_NAMES,
  ORTSTEILE,
  type DistrictName
} from "@jj/shared";

export interface DetectedLocation {
  bezirk?: DistrictName;
  ortsteil?: string;
  plz?: string;
}

/** Ortsteil names that double as ordinary German words or surnames; they
 *  only count next to "Berlin" or inside the address window. */
const AMBIGUOUS = new Set(["Mitte", "Wedding", "Lichtenberg", "Französisch Buchholz"]);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nameRe(name: string): RegExp {
  // Unicode-aware word boundary; tolerate "Prenzlauer Berg" vs "Prenzlauer-Berg".
  const body = escapeRe(name).replace(/[ -]/g, "[ -]");
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "giu");
}

const ORTSTEIL_TO_DISTRICT = new Map<string, DistrictName>();
for (const d of DISTRICT_NAMES) {
  for (const o of ORTSTEILE[d]) ORTSTEIL_TO_DISTRICT.set(o, d);
}

interface Hit<N extends string> {
  name: N;
  score: number;
  first: number;
}

function scan<N extends string>(
  text: string,
  names: readonly N[],
  weight: number,
  strict: boolean
): Hit<N>[] {
  const hits: Hit<N>[] = [];
  for (const name of names) {
    const re = nameRe(name);
    let score = 0;
    let first = Infinity;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const before = text.slice(Math.max(0, m.index - 12), m.index);
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 12);
      const nearBerlin = /Berlin[\s,/-]*$/i.test(before) || /^[\s,()/-]*Berlin/i.test(after);
      if (strict && AMBIGUOUS.has(name) && !nearBerlin) continue;
      score += weight * (nearBerlin ? 3 : 1);
      first = Math.min(first, m.index);
    }
    if (score > 0) hits.push({ name, score, first });
  }
  return hits.sort((a, b) => b.score - a.score || a.first - b.first);
}

function detectIn(text: string, strict: boolean): DetectedLocation {
  // Mask district names first so "Charlottenburg-Wilmersdorf" doesn't also
  // register as the Ortsteile "Charlottenburg" and "Wilmersdorf".
  const districts = scan(text, DISTRICT_NAMES, 1, strict);
  let masked = text;
  for (const d of DISTRICT_NAMES) masked = masked.replace(nameRe(d), (s) => " ".repeat(s.length));
  const ortsteile = scan(masked, [...ORTSTEIL_TO_DISTRICT.keys()], 1, strict);

  const result: DetectedLocation = {};
  const topDistrict = districts[0];
  const topOrtsteil = ortsteile[0];
  if (topOrtsteil) {
    const owner = ORTSTEIL_TO_DISTRICT.get(topOrtsteil.name)!;
    // A clearly named district beats an Ortsteil from somewhere else.
    if (topDistrict && topDistrict.name !== owner && topDistrict.score > topOrtsteil.score) {
      result.bezirk = topDistrict.name;
      const inDistrict = ortsteile.find(
        (o) => ORTSTEIL_TO_DISTRICT.get(o.name) === topDistrict.name
      );
      if (inDistrict) result.ortsteil = inDistrict.name;
    } else {
      result.bezirk = owner;
      result.ortsteil = topOrtsteil.name;
    }
  } else if (topDistrict) {
    result.bezirk = topDistrict.name;
  }
  return result;
}

/**
 * Finds the Berlin Bezirk / Ortsteil a page talks about. The address line
 * ("10405 Berlin, Prenzlauer Berg") is the most reliable signal, so a window
 * around the first Berlin postcode is tried before the whole text.
 */
export function detectLocation(text: string): DetectedLocation {
  const plz = /\b(1[0-4]\d{3})\s*,?\s*Berlin\b/i.exec(text);
  if (plz) {
    const i = plz.index;
    const win = text.slice(Math.max(0, i - 160), i + 220);
    const found = detectIn(win, false);
    if (found.bezirk) return { ...found, plz: plz[1] };
  }
  const whole = detectIn(text, true);
  return plz ? { ...whole, plz: plz[1] } : whole;
}

export function ortsteilDistrict(ortsteil: string): DistrictName | undefined {
  return ORTSTEIL_TO_DISTRICT.get(ortsteil);
}

/** Case/diacritic-tolerant lookup so AI output like "prenzlauer berg" maps
 *  onto the canonical Ortsteil spelling. */
export function canonicalOrtsteil(raw: string): string | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/[\s-]+/g, " ").trim();
  const target = norm(raw);
  for (const o of ORTSTEIL_TO_DISTRICT.keys()) {
    if (norm(o) === target) return o;
  }
  return undefined;
}
