import { describe, expect, it } from "vitest";
import { assertPublicHttpUrl } from "../src/fetch.js";

describe("assertPublicHttpUrl", () => {
  it("accepts ordinary public http(s) URLs", () => {
    expect(assertPublicHttpUrl("https://www.immobilienscout24.de/expose/1").hostname).toBe(
      "www.immobilienscout24.de"
    );
    expect(assertPublicHttpUrl("http://example.com/a?b=c").protocol).toBe("http:");
  });

  it("rejects non-http schemes", () => {
    for (const bad of ["ftp://example.com/x", "file:///etc/passwd", "javascript:alert(1)"]) {
      expect(() => assertPublicHttpUrl(bad)).toThrow();
    }
  });

  it("rejects loopback, private and link-local addresses", () => {
    for (const bad of [
      "http://localhost/",
      "http://127.0.0.1/",
      "http://10.0.0.8/",
      "http://172.20.1.1/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
      "http://[fd00::1]/",
      "http://metadata.google.internal/",
      "http://db.local/"
    ]) {
      expect(() => assertPublicHttpUrl(bad), bad).toThrow();
    }
  });

  it("rejects garbage", () => {
    expect(() => assertPublicHttpUrl("not a url")).toThrow();
  });
});
