import { describe, expect, it } from "vitest";
import {
  buildMember,
  buildSearch,
  itemToMember,
  itemToSearch,
  mergeSearch
} from "../../src/repo.js";
import { searchKeys } from "../../src/keys.js";

const now = "2026-10-28T12:00:00.000Z";
const SID = "01JD4WPKXK8Z1Q2W3E4R5T6Y7V";

describe("buildSearch", () => {
  it("fills default Berlin settings when none given", () => {
    const s = buildSearch({ clientName: "Brian" }, SID, now);
    expect(s.settings).toMatchObject({ gre: 6, notary: 2, provision: 3.57 });
    expect(s.status).toBe("active");
  });

  it("merges partial settings over defaults", () => {
    const s = buildSearch(
      { clientName: "Brian", settings: { rate: 45, budget: 750000 } },
      SID,
      now
    );
    expect(s.settings.rate).toBe(45);
    expect(s.settings.budget).toBe(750000);
    expect(s.settings.gre).toBe(6);
  });
});

describe("mergeSearch", () => {
  const existing = buildSearch(
    { clientName: "Brian", settings: { rate: 45 } },
    SID,
    now
  );
  it("updates only provided fields and bumps updatedAt", () => {
    const later = "2026-10-29T12:00:00.000Z";
    const merged = mergeSearch(existing, { status: "archived" }, later);
    expect(merged.clientName).toBe("Brian");
    expect(merged.status).toBe("archived");
    expect(merged.settings.rate).toBe(45);
    expect(merged.updatedAt).toBe(later);
    expect(merged.createdAt).toBe(now);
  });
  it("deep-merges settings", () => {
    const merged = mergeSearch(existing, { settings: { budget: 800000 } }, now);
    expect(merged.settings.budget).toBe(800000);
    expect(merged.settings.rate).toBe(45);
  });
});

describe("item mapping", () => {
  it("strips DynamoDB keys when parsing back", () => {
    const s = buildSearch({ clientName: "Brian" }, SID, now);
    const item = {
      ...searchKeys.search(s.id),
      ...searchKeys.searchListGsi(s.id),
      ...s
    };
    expect(itemToSearch(item)).toEqual(s);
  });

  it("member round-trip defaults missing lastSeenAt to null", () => {
    const m = buildMember({
      searchId: SID,
      userId: "sub-123",
      email: "brian@example.com",
      displayName: "Brian",
      role: "client",
      now
    });
    const item: Record<string, unknown> = {
      ...searchKeys.member(m.searchId, m.userId),
      ...searchKeys.memberGsi(m.userId, m.searchId),
      ...m
    };
    delete item.lastSeenAt; // stored without the attribute until first seen
    expect(itemToMember(item)).toEqual(m);
  });
});

describe("searchKeys", () => {
  it("membership GSI keys support the authorizer's user query", () => {
    expect(searchKeys.memberGsi("u1", SID)).toEqual({
      GSI1PK: "USER#u1",
      GSI1SK: `SEARCH#${SID}`
    });
  });
});
