/**
 * Dependency-free HTML helpers for the listing importer. We only need a few
 * things from a portal page — JSON-LD blobs, meta tags, readable text and
 * image URLs — so a handful of regexes beats pulling a DOM library into the
 * Lambda bundle.
 */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  euro: "€",
  szlig: "ß",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
  sup2: "²",
  deg: "°",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  middot: "·",
  bull: "•",
  laquo: "«",
  raquo: "»",
  shy: ""
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n =
        code[1]?.toLowerCase() === "x"
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff
        ? String.fromCodePoint(n)
        : match;
    }
    const v = ENTITIES[code];
    return v !== undefined ? v : match;
  });
}

export function looksLikeHtml(s: string): boolean {
  return /<\s*(!doctype|html|body|div|p|span|head|meta|script|title|article)\b/i.test(
    s.slice(0, 20_000)
  );
}

function attr(attrs: string, name: string): string | undefined {
  const re = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
    "i"
  );
  const m = re.exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
}

function flattenLd(v: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(v)) {
    for (const x of v) flattenLd(x, out);
    return;
  }
  if (v && typeof v === "object") {
    const obj = v as Record<string, unknown>;
    out.push(obj);
    if (obj["@graph"]) flattenLd(obj["@graph"], out);
  }
}

/** Every JSON-LD object on the page, @graph arrays flattened. */
export function extractJsonLd(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const re =
    /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = (m[1] ?? "").trim();
    if (!raw) continue;
    try {
      flattenLd(JSON.parse(raw), out);
    } catch {
      /* malformed JSON-LD is common; skip it */
    }
  }
  return out;
}

/** `<meta>` name/property → content (lower-cased keys), plus `title` and
 *  `canonical`. First occurrence wins. */
export function extractMeta(html: string): Record<string, string> {
  const meta: Record<string, string> = {};
  const re = /<meta\s+([^>]*?)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const attrs = m[1] ?? "";
    const name = attr(attrs, "property") ?? attr(attrs, "name") ?? attr(attrs, "itemprop");
    const content = attr(attrs, "content");
    if (!name || content === undefined) continue;
    const key = name.toLowerCase();
    if (meta[key] === undefined) meta[key] = decodeEntities(content).trim();
  }
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (t) meta["title"] = decodeEntities(t[1] ?? "").replace(/\s+/g, " ").trim();
  const c = /<link\s+[^>]*rel\s*=\s*["']canonical["'][^>]*>/i.exec(html);
  if (c) {
    const href = attr(c[0], "href");
    if (href) meta["canonical"] = href;
  }
  return meta;
}

/** Readable text with one line per block element. Table cells and
 *  definition lists collapse into "Label Value" lines, which is what the
 *  German key/value regexes in parse.ts expect. */
export function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(
    /<(script|style|noscript|svg|template|iframe|head)\b[^>]*>[\s\S]*?<\/\1>/gi,
    " "
  );
  s = s.replace(/<\s*br\s*\/?>/gi, "\n");
  s = s.replace(
    /<\/(p|div|li|tr|h[1-6]|dd|section|article|header|footer|table|ul|ol|blockquote|address|figure|figcaption|dl)\s*>/gi,
    "\n"
  );
  s = s.replace(/<\/(td|th|dt|span|a|strong|b|em|label)\s*>/gi, " ");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  s = s.replace(/ /g, " ");
  s = s.replace(/[ \t\f\v\r]+/g, " ");
  s = s.replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n");
  return s.trim();
}

const IMAGE_EXT = /\.(jpe?g|png|webp)(?=$|[/?#&])/i;
const URL_RE = /https?:\/\/[^\s"'<>\\(){}\[\]]+/gi;
const SKIP_IMAGE =
  /logo|icon|sprite|pixel|avatar|favicon|badge|banner|placeholder|blank|spacer|tracking|\/ads?\/|emoji|flag|\/map|static\/|assets\/img|button|arrow|star|rating|agent|makler|anbieter|profil|portrait|\/16x|\/32x|\/48x|\/64x|1x1|_xs\.|_s\.|\bthumb\b|\/thumbs?\/|energieausweis|qr/i;

function isCandidateImage(url: string): boolean {
  return IMAGE_EXT.test(url) && !SKIP_IMAGE.test(url);
}

function dedupeKey(url: string): string {
  return url.replace(/[?#].*$/, "").toLowerCase();
}

function stringsIn(v: unknown, out: string[], depth = 0): void {
  if (depth > 4) return;
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) stringsIn(x, out, depth + 1);
  else if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    // schema.org ImageObject
    if (typeof o["url"] === "string") out.push(o["url"]);
    if (typeof o["contentUrl"] === "string") out.push(o["contentUrl"]);
  }
}

/**
 * Candidate photo URLs, best first: og:image, JSON-LD images, then every
 * image-looking URL in the document (which also covers the JSON state blobs
 * portals embed for their galleries — escaped slashes are unescaped first).
 */
export function extractImageUrls(
  html: string,
  meta: Record<string, string>,
  jsonLd: Record<string, unknown>[],
  max = 30
): string[] {
  const seen = new Map<string, string>();
  const push = (raw: string) => {
    const url = raw.trim().replace(/[.,;:)]+$/, "");
    if (!/^https?:\/\//i.test(url) || !isCandidateImage(url)) return;
    const key = dedupeKey(url);
    if (!seen.has(key)) seen.set(key, url);
  };

  for (const k of ["og:image", "og:image:secure_url", "twitter:image"]) {
    if (meta[k]) push(meta[k]);
  }
  for (const obj of jsonLd) {
    const found: string[] = [];
    stringsIn(obj["image"], found);
    stringsIn(obj["photo"], found);
    stringsIn(obj["photos"], found);
    found.forEach(push);
  }
  const unescaped = html
    .replace(/\\\//g, "/")
    .replace(/\\u0026/g, "&")
    .replace(/&amp;/g, "&");
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(unescaped)) && seen.size < max * 4) push(m[0]);
  return [...seen.values()].slice(0, max);
}
