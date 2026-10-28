import { describe, expect, it } from "vitest";
import { briefSchema, listingCreateSchema, settingsSchema, type CustomerListing } from "@jj/shared";
import { benchChips, fitChips, mapQuery, siteName, sortCards } from "../src/lib/fit";

let seq = 0;
function make(partial: Partial<CustomerListing> & { title: string }): CustomerListing {
  const id = `01JD4WPKXK8Z1Q2W3E4R5T6Y${String(seq++).padStart(2, "0")}`;
  const base = listingCreateSchema
    .omit({ jjNotes: true, published: true })
    .parse({ title: partial.title, bezirk: partial.bezirk ?? "Mitte" });
  return {
    ...base,
    ...partial,
    id,
    createdAt: "2026-10-28T12:00:00.000Z",
    updatedAt: "2026-10-28T12:00:00.000Z"
  };
}

const settings = settingsSchema.parse({ budget: 750000 });
const brief = briefSchema.parse({
  budget: 750000,
  minSqm: 70,
  minBeds: 2,
  districts: ["Friedrichshain-Kreuzberg"],
  ortsteile: ["Prenzlauer Berg"]
});

describe("fitChips", () => {
  it("flags budget, size, bedrooms and area fit like the artifact", () => {
    const l = make({
      title: "Bright Altbau",
      bezirk: "Friedrichshain-Kreuzberg",
      ortsteil: "Kreuzberg",
      price: 489000,
      sqm: 78,
      beds: 2
    });
    const chips = fitChips(l, brief, settings);
    expect(chips.map((c) => [c.text, c.ok])).toEqual([
      ["Within budget", true],
      ["78 m² ≥ 70", true],
      ["2 bedrooms ≥ 2", true],
      ["Preferred district", true]
    ]);
  });

  it("marks over-budget all-in and ortsteil matches", () => {
    const l = make({
      title: "Charlottenburg classic",
      bezirk: "Charlottenburg-Wilmersdorf",
      price: 729000, // all-in ≈ 813k > 750k
      sqm: 96,
      beds: 3
    });
    const chips = fitChips(l, brief, settings);
    expect(chips[0]).toEqual({ ok: false, text: "Over budget" });
    expect(chips[3]).toEqual({ ok: false, text: "Other area" });

    const pb = make({
      title: "Helmholtzkiez roof flat",
      bezirk: "Pankow",
      ortsteil: "Prenzlauer Berg",
      price: 645000,
      sqm: 82,
      beds: 2
    });
    expect(fitChips(pb, brief, settings)[3]).toEqual({
      ok: true,
      text: "In Prenzlauer Berg"
    });
  });
});

describe("benchChips", () => {
  const bench = make({ title: "Benchmark", benchmark: true, price: 489000, sqm: 78 });
  it("computes €/m², price and size deltas vs the benchmark", () => {
    const l = make({ title: "Roof terrace", price: 645000, sqm: 82 });
    const chips = benchChips(l, bench);
    expect(chips).toHaveLength(3);
    expect(chips[0]!.text).toMatch(/€\/m² \+\d+% vs benchmark/);
    expect(chips[0]!.ok).toBe(false);
    expect(chips[2]).toEqual({ ok: true, text: "+4 m²" });
  });
  it("is empty for the benchmark itself or without one", () => {
    expect(benchChips(bench, bench)).toEqual([]);
    expect(benchChips(make({ title: "x" }), undefined)).toEqual([]);
  });
});

describe("map + site helpers", () => {
  it("street-looking kiez queries go direct, otherwise title+district", () => {
    expect(
      mapQuery(make({ title: "T", kiez: "Bergmannkiez, Zossener Str." }))
    ).toBe("Bergmannkiez, Zossener Str., Berlin");
    expect(mapQuery(make({ title: "Nice flat", bezirk: "Pankow", kiez: null }))).toBe(
      "Nice flat, Pankow, Berlin"
    );
  });
  it("recognises the big portals", () => {
    expect(siteName("https://www.immobilienscout24.de/expose/1")).toBe("ImmoScout24");
    expect(siteName("https://www.engelvoelkers.com/x")).toBe("Engel & Völkers");
    expect(siteName("not a url")).toBe("listing");
  });
});

describe("sortCards", () => {
  it("benchmark first, passed last, chosen sort between", () => {
    const bench = make({ title: "Bench", benchmark: true, price: 600000, sqm: 80 });
    const cheap = make({ title: "Cheap", price: 365000, sqm: 64 });
    const passed = make({ title: "Passed", status: "passed", price: 100000, sqm: 50 });
    const out = sortCards([passed, cheap, bench], "price", () => 0);
    expect(out.map((l) => l.title)).toEqual(["Bench", "Cheap", "Passed"]);
  });
});
