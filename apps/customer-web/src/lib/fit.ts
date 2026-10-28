/** Brief-fit and benchmark comparison logic, ported from the artifact. */
import {
  allInCost,
  pricePerSqm,
  type Brief,
  type CustomerListing,
  type Settings
} from "@jj/shared";

export interface Chip {
  ok: boolean;
  text: string;
}

export function fitChips(
  l: CustomerListing,
  brief: Brief,
  settings: Settings
): Chip[] {
  const out: Chip[] = [];
  const budget = brief.budget || settings.budget || 0;
  const cost = allInCost(l.price, settings, l.provision);
  if (budget && cost) {
    out.push({
      ok: cost.total <= budget,
      text: cost.total <= budget ? "Within budget" : "Over budget"
    });
  }
  if (brief.minSqm && l.sqm) {
    out.push({
      ok: l.sqm >= brief.minSqm,
      text: `${l.sqm} m² ${l.sqm >= brief.minSqm ? "≥" : "<"} ${brief.minSqm}`
    });
  }
  if (brief.minBeds && l.beds != null) {
    out.push({
      ok: l.beds >= brief.minBeds,
      text: `${l.beds} bedroom${l.beds === 1 ? "" : "s"} ${l.beds >= brief.minBeds ? "≥" : "<"} ${brief.minBeds}`
    });
  }
  const ot = brief.ortsteile ?? [];
  const hay = `${l.ortsteil ?? ""} ${l.kiez ?? ""} ${l.title}`.toLowerCase();
  const inOrt = l.ortsteil
    ? ot.find((o) => o === l.ortsteil)
    : ot.find((o) => hay.includes(o.toLowerCase()));
  const inDistrict = brief.districts.includes(l.bezirk);
  if ((brief.districts.length || ot.length) && l.bezirk) {
    out.push({
      ok: Boolean(inDistrict || inOrt),
      text: inOrt ? `In ${inOrt}` : inDistrict ? "Preferred district" : "Other area"
    });
  }
  return out;
}

const sign = (n: number): string => (n > 0 ? "+" : n < 0 ? "−" : "±");

export function benchChips(
  l: CustomerListing,
  benchmark: CustomerListing | undefined
): Chip[] {
  if (!benchmark || benchmark.id === l.id) return [];
  const out: Chip[] = [];
  const lp = pricePerSqm(l.price, l.sqm);
  const bp = pricePerSqm(benchmark.price, benchmark.sqm);
  if (lp && bp) {
    const d = Math.round((lp / bp - 1) * 100);
    out.push({ ok: d <= 0, text: `€/m² ${sign(d)}${Math.abs(d)}% vs benchmark` });
  }
  if (l.price && benchmark.price) {
    const d = l.price - benchmark.price;
    out.push({
      ok: d <= 0,
      text: `Price ${sign(d)}${new Intl.NumberFormat("en-IE", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 0
      }).format(Math.abs(d))}`
    });
  }
  if (l.sqm && benchmark.sqm) {
    const d = Math.round(l.sqm - benchmark.sqm);
    out.push({ ok: d >= 0, text: `${sign(d)}${Math.abs(d)} m²` });
  }
  return out;
}

/** Google Maps query, ported from the artifact. */
export function mapQuery(l: CustomerListing): string {
  const k = (l.kiez ?? "")
    .split("·")[0]!
    .replace(/\(.*?\)/g, "")
    .replace(/^near /i, "")
    .trim();
  return /\d{5}|str(\.|aße)|platz|allee/i.test(k)
    ? `${k}, Berlin`
    : `${k || l.title}, ${l.bezirk}, Berlin`;
}

export function mapUrl(l: CustomerListing): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery(l))}`;
}

export function allMapUrl(listings: CustomerListing[]): string | null {
  const stops = listings.filter((l) => l.status !== "passed" && l.kiez);
  if (stops.length < 2) return null;
  return `https://www.google.com/maps/dir/${stops
    .slice(0, 10)
    .map((l) => encodeURIComponent(mapQuery(l)))
    .join("/")}`;
}

export function siteName(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    if (/immobilienscout24/.test(h)) return "ImmoScout24";
    if (/kleinanzeigen/.test(h)) return "Kleinanzeigen";
    if (/engelvoelkers/.test(h)) return "Engel & Völkers";
    if (/immowelt/.test(h)) return "Immowelt";
    return h;
  } catch {
    return "listing";
  }
}

/** Card ordering, ported: chosen sort, then passed last, benchmark first. */
export function sortCards(
  listings: CustomerListing[],
  sort: "new" | "score" | "price" | "sqm",
  avgScore: (id: string) => number
): CustomerListing[] {
  const BIG = Number.MAX_SAFE_INTEGER;
  const copy = [...listings];
  const sorters: Record<string, (a: CustomerListing, b: CustomerListing) => number> = {
    new: (a, b) => b.id.localeCompare(a.id),
    score: (a, b) => avgScore(b.id) - avgScore(a.id),
    price: (a, b) => (a.price ?? BIG) - (b.price ?? BIG),
    sqm: (a, b) =>
      (pricePerSqm(a.price, a.sqm) ?? BIG) - (pricePerSqm(b.price, b.sqm) ?? BIG)
  };
  copy.sort(sorters[sort] ?? sorters.new!);
  copy.sort((a, b) => Number(a.status === "passed") - Number(b.status === "passed"));
  copy.sort((a, b) => Number(b.benchmark) - Number(a.benchmark));
  return copy;
}
