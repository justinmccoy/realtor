import { describe, expect, it } from "vitest";
import { allInCost, pricePerSqm } from "../src/costs.js";

const berlin = { gre: 6, notary: 2, provision: 3.57 };

describe("allInCost", () => {
  it("applies transfer tax + notary + default commission", () => {
    const c = allInCost(489_000, berlin);
    expect(c).not.toBeNull();
    expect(c!.pct).toBeCloseTo(11.57);
    expect(c!.total).toBe(Math.round(489_000 * 1.1157));
    expect(c!.provision).toBe(3.57);
  });

  it("uses the listing's commission override, including 0 (commission-free)", () => {
    const c = allInCost(419_000, berlin, 0);
    expect(c!.pct).toBe(8);
    expect(c!.total).toBe(Math.round(419_000 * 1.08));
  });

  it("returns null without a usable price", () => {
    expect(allInCost(null, berlin)).toBeNull();
    expect(allInCost(0, berlin)).toBeNull();
    expect(allInCost(-5, berlin)).toBeNull();
  });
});

describe("pricePerSqm", () => {
  it("rounds to whole euros", () => {
    expect(pricePerSqm(489_000, 78)).toBe(Math.round(489_000 / 78));
  });
  it("returns null when either side is missing", () => {
    expect(pricePerSqm(null, 78)).toBeNull();
    expect(pricePerSqm(489_000, 0)).toBeNull();
  });
});
