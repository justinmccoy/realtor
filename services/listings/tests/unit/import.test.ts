import { describe, expect, it } from "vitest";
import {
  decodeEntities,
  extractImageUrls,
  extractJsonLd,
  extractMeta,
  htmlToText,
  looksLikeHtml
} from "../../src/import/html.js";
import { cleanTitle, parseGermanNumber, parsePage } from "../../src/import/parse.js";
import { canonicalOrtsteil, detectLocation } from "../../src/import/geo.js";
import { applyProxyKey, looksLikeBotWall } from "../../src/import/fetchPage.js";
import { runImport, type ImportDeps } from "../../src/import/index.js";

const PORTAL_HTML = `<!doctype html><html><head>
<title>Helle 3-Zimmer-Altbauwohnung mit Balkon in Prenzlauer Berg - ImmobilienScout24</title>
<meta property="og:title" content="Helle 3-Zimmer-Altbauwohnung mit Balkon in Prenzlauer Berg">
<meta property="og:description" content="Sanierter Altbau, 3. OG, S&uuml;dbalkon.">
<meta property="og:image" content="https://pictures.example-cdn.de/listings/abc-1.jpg/ORIG/legacy_thumbnail/1106x830/format/webp/quality/73">
<link rel="canonical" href="https://www.immobilienscout24.de/expose/123456">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Apartment","name":"Helle 3-Zimmer-Altbauwohnung","address":{"@type":"PostalAddress","streetAddress":"Rykestraße 12","postalCode":"10405","addressLocality":"Berlin"},"image":["https://pictures.example-cdn.de/listings/abc-2.jpg","https://pictures.example-cdn.de/listings/abc-3.jpg"]}</script>
<script>window.__STATE__ = {"gallery":[{"url":"https:\\/\\/pictures.example-cdn.de\\/listings\\/abc-4.jpg"}],"logo":"https://static.example-cdn.de/logo.png"}</script>
<style>.x{background:url(https://static.example-cdn.de/sprite.png)}</style>
</head><body>
<h1>Helle 3-Zimmer-Altbauwohnung mit Balkon</h1>
<div class="address">Rykestraße 12, 10405 Berlin, Prenzlauer Berg (Prenzlauer Berg)</div>
<dl>
<dt>Kaufpreis</dt><dd>489.000 &euro;</dd>
<dt>Wohnfläche ca.</dt><dd>78,5 m²</dd>
<dt>Zimmer</dt><dd>3</dd>
<dt>Schlafzimmer</dt><dd>2</dd>
<dt>Badezimmer</dt><dd>1</dd>
<dt>Etage</dt><dd>3 von 5</dd>
<dt>Baujahr</dt><dd>1908</dd>
<dt>Hausgeld</dt><dd>340 €</dd>
<dt>Provision für Käufer</dt><dd>3,57 % inkl. MwSt.</dd>
</dl>
<h2>Objektbeschreibung</h2>
<p>Die Wohnung liegt im 3. OG eines sanierten Altbaus. Südbalkon, Parkett, Gasetagenheizung.</p>
<h2>Ausstattung</h2><p>Balkon, Kelleranteil</p>
<img src="https://pictures.example-cdn.de/listings/abc-5.jpg" alt="">
<img src="https://static.example-cdn.de/icons/star.png" alt="">
</body></html>`;

const PASTED_TEXT = `Schöne 2-Zimmer-Wohnung in Friedrichshain
10245 Berlin - Friedrichshain
Preis: 320.000 € VB
Wohnfläche: 55 m²
Zimmer: 2
Etage: 2
Baujahr: 1960
provisionsfrei
Kein Balkon, aber ruhige Lage im Hinterhaus.`;

describe("html helpers", () => {
  it("decodes named, decimal and hex entities", () => {
    expect(decodeEntities("489.000&nbsp;&euro; &amp; 78&#44;5&#x20;m&sup2;")).toBe(
      "489.000 € & 78,5 m²"
    );
  });

  it("extracts JSON-LD, meta and canonical", () => {
    const ld = extractJsonLd(PORTAL_HTML);
    expect(ld).toHaveLength(1);
    expect(ld[0]?.["name"]).toBe("Helle 3-Zimmer-Altbauwohnung");
    const meta = extractMeta(PORTAL_HTML);
    expect(meta["og:description"]).toBe("Sanierter Altbau, 3. OG, Südbalkon.");
    expect(meta["canonical"]).toBe("https://www.immobilienscout24.de/expose/123456");
    expect(meta["title"]).toMatch(/^Helle 3-Zimmer/);
  });

  it("turns definition lists into label/value lines", () => {
    const text = htmlToText(PORTAL_HTML);
    expect(text).toContain("Kaufpreis 489.000 €");
    expect(text).toContain("Wohnfläche ca. 78,5 m²");
    expect(text).not.toContain("__STATE__");
    expect(text).not.toContain("background:url");
  });

  it("collects photo URLs best-first and skips chrome", () => {
    const meta = extractMeta(PORTAL_HTML);
    const urls = extractImageUrls(PORTAL_HTML, meta, extractJsonLd(PORTAL_HTML));
    expect(urls[0]).toMatch(/abc-1\.jpg/);
    expect(urls.slice(1, 3)).toEqual([
      "https://pictures.example-cdn.de/listings/abc-2.jpg",
      "https://pictures.example-cdn.de/listings/abc-3.jpg"
    ]);
    expect(urls).toContain("https://pictures.example-cdn.de/listings/abc-4.jpg");
    expect(urls).toContain("https://pictures.example-cdn.de/listings/abc-5.jpg");
    expect(urls.join(" ")).not.toMatch(/logo|sprite|star/);
  });

  it("recognises html vs plain text", () => {
    expect(looksLikeHtml(PORTAL_HTML)).toBe(true);
    expect(looksLikeHtml(PASTED_TEXT)).toBe(false);
  });
});

describe("parseGermanNumber", () => {
  it("handles German and English separators", () => {
    expect(parseGermanNumber("489.000")).toBe(489000);
    expect(parseGermanNumber("489.000,50 €")).toBe(489000.5);
    expect(parseGermanNumber("78,5 m²")).toBe(78.5);
    expect(parseGermanNumber("3,57")).toBe(3.57);
    expect(parseGermanNumber("1,234.56")).toBe(1234.56);
    expect(parseGermanNumber("12.5")).toBe(12.5);
    expect(parseGermanNumber("")).toBeNull();
  });
});

describe("cleanTitle", () => {
  it("strips portal suffixes", () => {
    expect(cleanTitle("Tolle Wohnung - ImmobilienScout24")).toBe("Tolle Wohnung");
    expect(cleanTitle("Tolle Wohnung in Berlin - Pankow | Kleinanzeigen ist jetzt Kleinanzeigen")).toBe(
      "Tolle Wohnung"
    );
  });
});

describe("detectLocation", () => {
  it("prefers the address line near the postcode", () => {
    const loc = detectLocation(htmlToText(PORTAL_HTML));
    expect(loc).toMatchObject({ bezirk: "Pankow", ortsteil: "Prenzlauer Berg", plz: "10405" });
  });

  it("maps an Ortsteil to its district", () => {
    expect(detectLocation(PASTED_TEXT)).toMatchObject({
      bezirk: "Friedrichshain-Kreuzberg",
      ortsteil: "Friedrichshain"
    });
  });

  it("does not take 'Mitte' as a district from ordinary prose", () => {
    expect(detectLocation("Das Bad liegt in der Mitte der Wohnung.").bezirk).toBeUndefined();
    expect(detectLocation("Wohnen in Berlin-Mitte, nahe Hackescher Markt").bezirk).toBe("Mitte");
  });

  it("keeps a clearly named district over a stray Ortsteil mention", () => {
    const loc = detectLocation(
      "Charlottenburg-Wilmersdorf: Wohnung nahe Savignyplatz. Ähnliche Objekte: Neukölln"
    );
    expect(loc.bezirk).toBe("Charlottenburg-Wilmersdorf");
  });

  it("canonicalises Ortsteil spelling", () => {
    expect(canonicalOrtsteil("prenzlauer-berg")).toBe("Prenzlauer Berg");
    expect(canonicalOrtsteil("Atlantis")).toBeUndefined();
  });
});

describe("parsePage", () => {
  it("extracts the key facts from a portal page", () => {
    const html = PORTAL_HTML;
    const { fields, provenance } = parsePage({
      text: htmlToText(html),
      meta: extractMeta(html),
      jsonLd: extractJsonLd(html),
      url: "https://www.immobilienscout24.de/expose/123456?x=1"
    });
    expect(fields).toMatchObject({
      title: "Helle 3-Zimmer-Altbauwohnung",
      url: "https://www.immobilienscout24.de/expose/123456",
      price: 489000,
      sqm: 78.5,
      rooms: 3,
      beds: 2,
      baths: 1,
      floor: "3 von 5",
      year: "1908",
      hausgeld: 340,
      provision: 3.57,
      balcony: "yes",
      bezirk: "Pankow",
      ortsteil: "Prenzlauer Berg",
      kiez: "Rykestraße 12"
    });
    expect(fields.notes).toContain("Südbalkon");
    expect(fields.notes).toContain("Gasetagenheizung");
    expect(provenance.price).toBe("page");
    expect(Object.values(provenance).every((p) => p === "page")).toBe(true);
  });

  it("copes with pasted plain text", () => {
    const { fields } = parsePage({ text: PASTED_TEXT, meta: {}, jsonLd: [] });
    expect(fields).toMatchObject({
      price: 320000,
      sqm: 55,
      rooms: 2,
      floor: "2",
      year: "1960",
      provision: 0,
      balcony: "no",
      bezirk: "Friedrichshain-Kreuzberg",
      ortsteil: "Friedrichshain"
    });
    expect(fields.title).toBeUndefined();
  });
});

describe("applyProxyKey", () => {
  const tpl = "https://app.scrapingbee.com/api/v1/?api_key={key}&render_js=true&url={url}";

  it("substitutes and URL-encodes the key", () => {
    expect(applyProxyKey(tpl, "abc 123")).toBe(
      "https://app.scrapingbee.com/api/v1/?api_key=abc%20123&render_js=true&url={url}"
    );
  });

  it("disables the proxy when the template needs a key that is missing", () => {
    expect(applyProxyKey(tpl, null)).toBeUndefined();
    expect(applyProxyKey("", "k")).toBeUndefined();
    expect(applyProxyKey(undefined, "k")).toBeUndefined();
  });

  it("passes key-less templates through untouched", () => {
    expect(applyProxyKey(" https://proxy.example/?url={url} ", null)).toBe(
      "https://proxy.example/?url={url}"
    );
  });
});

describe("looksLikeBotWall", () => {
  it("flags blocked statuses and captcha pages", () => {
    expect(looksLikeBotWall(403, "")).toBe(true);
    expect(looksLikeBotWall(200, "<title>Just a moment...</title>")).toBe(true);
    expect(looksLikeBotWall(200, PORTAL_HTML)).toBe(false);
    expect(looksLikeBotWall(404, "captcha")).toBe(false);
  });
});

function deps(overrides: Partial<ImportDeps> = {}): ImportDeps {
  return {
    fetchPage: async () => ({
      html: PORTAL_HTML,
      finalUrl: "https://www.immobilienscout24.de/expose/123456",
      via: "direct",
      truncated: false
    }),
    ai: async () => null,
    aiTimeoutMs: 1000,
    ...overrides
  };
}

describe("runImport", () => {
  it("builds a draft from a fetched page without AI", async () => {
    const out = await runImport({ url: "https://www.immobilienscout24.de/expose/123456" }, deps());
    expect(out.fetchedVia).toBe("direct");
    expect(out.portal).toBe("immobilienscout24.de");
    expect(out.aiUsed).toBe(false);
    expect(out.fields.price).toBe(489000);
    expect(out.photoUrls.length).toBeGreaterThanOrEqual(5);
    expect(out.warnings).toContain(
      "AI extraction is not configured; only the page markup was parsed."
    );
  });

  it("lets the AI fill gaps and override page values, but not the url", async () => {
    const out = await runImport(
      { url: "https://www.immobilienscout24.de/expose/123456" },
      deps({
        ai: async () => ({
          model: "test",
          truncated: false,
          fields: {
            url: "https://evil.example/elsewhere",
            floor: "3. OG von 5",
            year: "1908, saniert 2015",
            price: 489000
          }
        })
      })
    );
    expect(out.aiUsed).toBe(true);
    expect(out.fields.url).toBe("https://www.immobilienscout24.de/expose/123456");
    expect(out.fields.floor).toBe("3. OG von 5");
    expect(out.provenance.floor).toBe("ai");
    expect(out.provenance.sqm).toBe("page");
  });

  it("reconciles district from the Ortsteil and warns when neither is known", async () => {
    const out = await runImport(
      { content: "Wohnung in Kreuzberg\nKaufpreis 400.000 €\nWohnfläche 60 m²\n2 Zimmer" },
      deps({
        ai: async () => ({ model: "t", truncated: false, fields: { ortsteil: "Kreuzberg", bezirk: "Mitte" } })
      })
    );
    expect(out.fields.bezirk).toBe("Friedrichshain-Kreuzberg");
    expect(out.fields.ortsteil).toBe("Kreuzberg");
    expect(out.fetchedVia).toBe("paste");

    const unknown = await runImport(
      { content: "Eine Wohnung irgendwo.\nKaufpreis 400.000 €\nWohnfläche 60 m²\n2 Zimmer" },
      deps()
    );
    expect(unknown.fields.bezirk).toBe("Mitte");
    expect(unknown.warnings.join(" ")).toMatch(/District could not be detected/);
    expect(unknown.fields.title).toBe("Imported listing");
  });

  it("treats pre-fetched HTML like a fetched page, keeping how it was fetched", async () => {
    const out = await runImport(
      {
        url: "https://www.immobilienscout24.de/expose/123456",
        content: PORTAL_HTML,
        fetchedVia: "proxy"
      },
      deps({
        fetchPage: async () => {
          throw new Error("must not fetch when content is supplied");
        }
      })
    );
    expect(out.fetchedVia).toBe("proxy");
    expect(out.portal).toBe("immobilienscout24.de");
    expect(out.fields.price).toBe(489000);
    expect(out.photoUrls.length).toBeGreaterThanOrEqual(5);
  });

  it("survives an AI failure", async () => {
    const out = await runImport(
      { url: "https://www.immobilienscout24.de/expose/123456" },
      deps({
        ai: async () => {
          throw new Error("boom");
        }
      })
    );
    expect(out.aiUsed).toBe(false);
    expect(out.fields.price).toBe(489000);
    expect(out.warnings.join(" ")).toMatch(/AI extraction failed/);
  });
});
