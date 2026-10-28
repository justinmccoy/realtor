import { describe, expect, it } from "vitest";
import {
  briefSchema,
  hoursCreateSchema,
  listingCreateSchema,
  ratingPutSchema,
  settingsSchema
} from "../src/index.js";

describe("listingCreateSchema", () => {
  it("accepts a minimal listing and fills defaults", () => {
    const l = listingCreateSchema.parse({
      title: "Bright Altbau with balcony",
      bezirk: "Friedrichshain-Kreuzberg"
    });
    expect(l.status).toBe("new");
    expect(l.published).toBe(false);
    expect(l.pros).toEqual([]);
    expect(l.provision).toBeNull();
  });

  it("rejects an unknown district", () => {
    expect(() =>
      listingCreateSchema.parse({ title: "x", bezirk: "Hamburg-Altona" })
    ).toThrow();
  });

  it("rejects a non-https url and out-of-range rank", () => {
    expect(() =>
      listingCreateSchema.parse({
        title: "x",
        bezirk: "Mitte",
        url: "javascript:alert(1)"
      })
    ).toThrow();
    expect(() =>
      listingCreateSchema.parse({ title: "x", bezirk: "Mitte", topRank: 6 })
    ).toThrow();
  });
});

describe("settings & brief", () => {
  it("defaults to Berlin purchase percentages", () => {
    const s = settingsSchema.parse({});
    expect(s).toMatchObject({ gre: 6, notary: 2, provision: 3.57 });
  });
  it("brief accepts districts and ortsteile", () => {
    const b = briefSchema.parse({
      budget: 750000,
      districts: ["Friedrichshain-Kreuzberg"],
      ortsteile: ["Prenzlauer Berg", "Schöneberg"]
    });
    expect(b.minSqm).toBe(0);
  });
});

describe("hours & ratings", () => {
  it("validates date format and minute bounds", () => {
    expect(() =>
      hoursCreateSchema.parse({ date: "28.10.2026", minutes: 60, category: "Research" })
    ).toThrow();
    expect(() =>
      hoursCreateSchema.parse({ date: "2026-10-28", minutes: 0, category: "Research" })
    ).toThrow();
    const h = hoursCreateSchema.parse({
      date: "2026-10-28",
      minutes: 90,
      category: "Viewing"
    });
    expect(h.listingId).toBeNull();
  });

  it("rating score must be 1..5 integer", () => {
    expect(() => ratingPutSchema.parse({ score: 0 })).toThrow();
    expect(() => ratingPutSchema.parse({ score: 4.5 })).toThrow();
    expect(ratingPutSchema.parse({ score: 4 }).comment).toBe("");
  });
});
