import { describe, expect, it } from "vitest";
import { listingCreateSchema, type Listing } from "@jj/shared";
import {
  applyFilters,
  buildListing,
  mergeListing,
  paginateOffset,
  sortListings,
  toCustomerListing
} from "../../src/domain.js";

const SID = "01JD4WPKXK8Z1Q2W3E4R5T6Y7V";
const now = "2026-10-28T12:00:00.000Z";

let seq = 0;
function make(partial: Partial<Listing> & { title: string }): Listing {
  // ULIDs sort lexicographically; bump the tail to emulate creation order.
  const id = `01JD4WPKXK8Z1Q2W3E4R5T6Y${String(seq++).padStart(2, "0")}`;
  const base = listingCreateSchema.parse({
    title: partial.title,
    bezirk: partial.bezirk ?? "Mitte"
  });
  return { ...base, ...partial, id, searchId: SID, createdAt: now, updatedAt: now };
}

describe("sortListings", () => {
  const cheap = make({ title: "Cheap", price: 365000, sqm: 64 });
  const mid = make({ title: "Mid", price: 489000, sqm: 78 });
  const noPrice = make({ title: "NoPrice" });
  const bench = make({ title: "Bench", benchmark: true, price: 600000, sqm: 80 });
  const passed = make({ title: "Passed", status: "passed", price: 100000, sqm: 50 });

  it("price sort puts null prices last, benchmark first, passed last", () => {
    const out = sortListings([noPrice, passed, mid, bench, cheap], "price");
    expect(out[0]!.title).toBe("Bench");
    expect(out[out.length - 1]!.title).toBe("Passed");
    const middle = out.slice(1, -1).map((l) => l.title);
    expect(middle).toEqual(["Cheap", "Mid", "NoPrice"]);
  });

  it("sqm sort orders by €/m²", () => {
    // Cheap: 5703 €/m², Mid: 6269 €/m², Bench: 7500 €/m²
    const out = sortListings([mid, bench, cheap], "sqm");
    expect(out.map((l) => l.title)).toEqual(["Bench", "Cheap", "Mid"]);
  });

  it("new sort is by id descending (creation order)", () => {
    const a = make({ title: "A" });
    const b = make({ title: "B" });
    expect(sortListings([a, b], "new").map((l) => l.title)).toEqual(["B", "A"]);
  });
});

describe("applyFilters", () => {
  const items = [
    make({ title: "Altbau Kreuzberg", bezirk: "Friedrichshain-Kreuzberg", published: true }),
    make({ title: "Neubau Rummelsburg", bezirk: "Lichtenberg", status: "short" }),
    make({ title: "Wedding flat", kiez: "Sprengelkiez", published: true })
  ];

  it("filters by status, bezirk, published and free text", () => {
    expect(applyFilters(items, { status: "short" })).toHaveLength(1);
    expect(applyFilters(items, { bezirk: "Lichtenberg" })).toHaveLength(1);
    expect(applyFilters(items, { published: true })).toHaveLength(2);
    expect(applyFilters(items, { q: "sprengel" })).toHaveLength(1);
    expect(applyFilters(items, { q: "SPRENGEL" })).toHaveLength(1);
    expect(applyFilters(items, {})).toHaveLength(3);
  });
});

describe("paginateOffset", () => {
  const items = ["a", "b", "c", "d", "e"];
  it("pages with an opaque cursor and terminates", () => {
    const p1 = paginateOffset(items, 2, undefined);
    expect(p1.items).toEqual(["a", "b"]);
    const p2 = paginateOffset(items, 2, p1.nextCursor!);
    expect(p2.items).toEqual(["c", "d"]);
    const p3 = paginateOffset(items, 2, p2.nextCursor!);
    expect(p3.items).toEqual(["e"]);
    expect(p3.nextCursor).toBeNull();
  });
  it("rejects garbage cursors", () => {
    expect(() => paginateOffset(items, 2, "!!!!")).toThrow();
  });
});

describe("customer projection", () => {
  it("strips jjNotes and published", () => {
    const l = make({ title: "X", jjNotes: "agent phone number", published: true });
    const c = toCustomerListing(l) as Record<string, unknown>;
    expect(c.jjNotes).toBeUndefined();
    expect(c.published).toBeUndefined();
    expect(c.title).toBe("X");
    expect(c.jjComments).toBeDefined();
  });
});

describe("build/merge", () => {
  it("merge keeps identity fields and bumps updatedAt", () => {
    const input = listingCreateSchema.parse({ title: "T", bezirk: "Mitte" });
    const l = buildListing(SID, input, "01JD4WPKXK8Z1Q2W3E4R5T6Y99".slice(0, 26), now);
    const later = "2026-10-29T12:00:00.000Z";
    const m = mergeListing(l, { price: 500000, status: "short" }, later);
    expect(m.id).toBe(l.id);
    expect(m.searchId).toBe(SID);
    expect(m.price).toBe(500000);
    expect(m.status).toBe("short");
    expect(m.createdAt).toBe(now);
    expect(m.updatedAt).toBe(later);
  });
});
