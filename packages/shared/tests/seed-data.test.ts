import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { briefSchema, listingCreateSchema, searchCreateSchema } from "../src/index.js";

/** The example seed must always pass the schemas the seed script applies —
 *  a single invalid field used to abort seeding half-way. */
const seed = JSON.parse(
  readFileSync(join(__dirname, "../../../seed/example-data.json"), "utf8")
) as {
  search: unknown;
  brief: unknown;
  listings: Record<string, unknown>[];
};

describe("seed/example-data.json", () => {
  it("search and brief parse", () => {
    expect(() => searchCreateSchema.parse(seed.search)).not.toThrow();
    expect(() => briefSchema.parse(seed.brief)).not.toThrow();
  });

  it("every listing parses", () => {
    const failures = seed.listings
      .map((raw, i) => {
        const r = listingCreateSchema.safeParse(raw);
        return r.success
          ? null
          : `listing ${i + 1} (${String(raw.title)}): ${r.error.issues
              .map((x) => `${x.path.join(".")}: ${x.message}`)
              .join("; ")}`;
      })
      .filter(Boolean);
    expect(failures).toEqual([]);
    expect(seed.listings).toHaveLength(8);
  });
});
