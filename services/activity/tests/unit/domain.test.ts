import { describe, expect, it } from "vitest";
import { CLIENT_EVENT_TYPES } from "@jj/shared";
import {
  clientEventSummary,
  rollupField,
  ttlEpoch,
  ACTIVITY_TTL_DAYS
} from "../../src/domain.js";

describe("rollupField", () => {
  it("maps listing interactions to counters", () => {
    expect(rollupField("listing_expanded")).toBe("expands");
    expect(rollupField("photo_viewed")).toBe("photoViews");
    expect(rollupField("floorplan_viewed")).toBe("photoViews");
    expect(rollupField("expose_clicked")).toBe("exposeClicks");
    expect(rollupField("map_clicked")).toBe("mapClicks");
  });
  it("non-listing events don't bump counters", () => {
    expect(rollupField("session_start")).toBeNull();
    expect(rollupField("brief_viewed")).toBeNull();
    expect(rollupField("hours_viewed")).toBeNull();
  });
});

describe("clientEventSummary", () => {
  it("produces a readable line for every event type", () => {
    for (const type of CLIENT_EVENT_TYPES) {
      const s = clientEventSummary("Brian", type);
      expect(s).toContain("Brian");
      expect(s.length).toBeGreaterThan(10);
    }
  });
});

describe("ttlEpoch", () => {
  it("expires 180 days out, in epoch seconds", () => {
    const now = Date.UTC(2026, 9, 28);
    expect(ttlEpoch(now)).toBe(Math.floor(now / 1000) + ACTIVITY_TTL_DAYS * 86_400);
  });
});
