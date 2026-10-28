import { describe, expect, it } from "vitest";
import {
  briefSchema,
  briefHasCriteria,
  listingCreateSchema,
  matchesBrief,
  settingsSchema,
  visibility
} from "../src/index.js";

const settings = settingsSchema.parse({ budget: 750000 });
const brief = briefSchema.parse({
  budget: 750000,
  minSqm: 70,
  minBeds: 2,
  districts: ["Friedrichshain-Kreuzberg"],
  ortsteile: ["Prenzlauer Berg"]
});

const make = (over: Record<string, unknown>) => ({
  ...listingCreateSchema.parse({ title: "T", bezirk: "Mitte", ...over }),
  id: "01JD4WPKXK8Z1Q2W3E4R5T6Y7V",
  createdAt: "2026-10-28T12:00:00.000Z",
  updatedAt: "2026-10-28T12:00:00.000Z"
});

const good = make({
  bezirk: "Friedrichshain-Kreuzberg",
  price: 489000, // all-in ≈ 546k ≤ 750k
  sqm: 78,
  beds: 2,
  published: true
});

describe("matchesBrief", () => {
  it("passes when every set criterion passes", () => {
    expect(matchesBrief(good, brief, settings)).toBe(true);
  });
  it("fails on over-budget all-in, size, beds, or area", () => {
    expect(matchesBrief(make({ ...good, price: 729000 }), brief, settings)).toBe(false);
    expect(matchesBrief(make({ ...good, sqm: 64 }), brief, settings)).toBe(false);
    expect(matchesBrief(make({ ...good, beds: 1 }), brief, settings)).toBe(false);
    expect(
      matchesBrief(make({ ...good, bezirk: "Spandau", ortsteil: null }), brief, settings)
    ).toBe(false);
  });
  it("ortsteil matches across districts", () => {
    const pb = make({ ...good, bezirk: "Pankow", ortsteil: "Prenzlauer Berg" });
    expect(matchesBrief(pb, brief, settings)).toBe(true);
  });
  it("unknown values fail the criterion (manual share instead)", () => {
    expect(matchesBrief(make({ ...good, price: null }), brief, settings)).toBe(false);
    expect(matchesBrief(make({ ...good, sqm: null }), brief, settings)).toBe(false);
  });
  it("an empty brief matches nothing", () => {
    const empty = briefSchema.parse({});
    const zeroSettings = settingsSchema.parse({});
    expect(briefHasCriteria(empty, zeroSettings)).toBe(false);
    expect(matchesBrief(good, empty, zeroSettings)).toBe(false);
  });
});

describe("visibility", () => {
  it("drafts are invisible no matter what", () => {
    const draft = make({ ...good, published: false });
    expect(visibility(draft, brief, settings, "shared")).toEqual({
      visible: false,
      reason: "draft"
    });
  });
  it("manual share beats no-match; hide beats match", () => {
    const noMatch = make({ ...good, price: 2000000 });
    expect(visibility(noMatch, brief, settings, "shared").visible).toBe(true);
    expect(visibility(good, brief, settings, "hidden")).toEqual({
      visible: false,
      reason: "hidden"
    });
  });
  it("auto-match grants visibility without a share record", () => {
    expect(visibility(good, brief, settings, undefined)).toEqual({
      visible: true,
      reason: "match"
    });
  });
});
