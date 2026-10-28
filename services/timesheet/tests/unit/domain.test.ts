import { describe, expect, it } from "vitest";
import type { HoursEntry } from "@jj/shared";
import {
  dateOf,
  entriesInMonth,
  fmtMinutes,
  mergeEntry,
  sortEntries,
  timerMinutes
} from "../../src/domain.js";

const base: HoursEntry = {
  id: "01JD4WPKXK8Z1Q2W3E4R5T6Y00",
  searchId: "01JD4WPKXK8Z1Q2W3E4R5T6Y7V",
  date: "2026-10-10",
  minutes: 90,
  category: "Viewing",
  listingId: null,
  note: "Bergmannkiez viewing",
  paid: false,
  paidAt: null,
  createdAt: "2026-10-10T12:00:00.000Z"
};
const now = "2026-10-28T12:00:00.000Z";

describe("mergeEntry paid transitions", () => {
  it("sets paidAt when marking paid, clears it when unmarking", () => {
    const paid = mergeEntry(base, { paid: true }, now);
    expect(paid.paid).toBe(true);
    expect(paid.paidAt).toBe(now);

    const unpaid = mergeEntry(paid, { paid: false }, now);
    expect(unpaid.paid).toBe(false);
    expect(unpaid.paidAt).toBeNull();
  });

  it("keeps the original paidAt when paid state is untouched", () => {
    const paid = mergeEntry(base, { paid: true }, "2026-10-20T00:00:00.000Z");
    const edited = mergeEntry(paid, { minutes: 120 }, now);
    expect(edited.minutes).toBe(120);
    expect(edited.paidAt).toBe("2026-10-20T00:00:00.000Z");
    expect(edited.paid).toBe(true);
  });
});

describe("month grouping and sorting", () => {
  const sept = { ...base, id: "01JD4WPKXK8Z1Q2W3E4R5T6Y01", date: "2026-09-28" };
  const octLate = { ...base, id: "01JD4WPKXK8Z1Q2W3E4R5T6Y02", date: "2026-10-21" };
  it("entriesInMonth filters by YYYY-MM prefix", () => {
    expect(entriesInMonth([base, sept, octLate], "2026-10")).toHaveLength(2);
    expect(entriesInMonth([base, sept, octLate], "2026-09")).toHaveLength(1);
  });
  it("sortEntries is newest date first", () => {
    expect(sortEntries([sept, base, octLate]).map((e) => e.date)).toEqual([
      "2026-10-21",
      "2026-10-10",
      "2026-09-28"
    ]);
  });
});

describe("fmtMinutes / timer math", () => {
  it("formats like the artifact", () => {
    expect(fmtMinutes(45)).toBe("45m");
    expect(fmtMinutes(90)).toBe("1h 30m");
    expect(fmtMinutes(60)).toBe("1h 00m");
  });
  it("timer rounds to whole minutes with a 1-minute floor", () => {
    const start = "2026-10-28T12:00:00.000Z";
    expect(timerMinutes(start, new Date("2026-10-28T12:00:10.000Z"))).toBe(1);
    expect(timerMinutes(start, new Date("2026-10-28T13:31:40.000Z"))).toBe(92);
  });
  it("dateOf extracts the start date", () => {
    expect(dateOf("2026-10-28T23:59:00.000Z")).toBe("2026-10-28");
  });
});
