import { describe, expect, it } from "vitest";
import { customerSiteUrl, listingPreviewUrl } from "../src/lib/customerSite";

describe("customerSiteUrl", () => {
  it("prefers the configured URL, trimmed of trailing slashes", () => {
    expect(customerSiteUrl("https://genauhere.de/", "https://admin.genauhere.de")).toBe(
      "https://genauhere.de"
    );
    expect(customerSiteUrl("https://d2sypuxkeexa2n.cloudfront.net", "http://localhost:5174")).toBe(
      "https://d2sypuxkeexa2n.cloudfront.net"
    );
  });

  it("derives the client site from an admin.<domain> hostname", () => {
    expect(customerSiteUrl(undefined, "https://admin.genauhere.de")).toBe("https://genauhere.de");
    expect(customerSiteUrl("", "https://admin.genauhere.de")).toBe("https://genauhere.de");
  });

  it("gives up when neither is available", () => {
    expect(customerSiteUrl(undefined, "https://dveqa1ss76yri.cloudfront.net")).toBeNull();
    expect(customerSiteUrl(undefined, "http://localhost:5174")).toBeNull();
    expect(customerSiteUrl(undefined, "")).toBeNull();
  });
});

describe("listingPreviewUrl", () => {
  it("targets the client app's hash route", () => {
    expect(listingPreviewUrl("https://genauhere.de", "01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(
      "https://genauhere.de/#listing-01ARZ3NDEKTSV4RRFFQ69G5FAV"
    );
  });
});
