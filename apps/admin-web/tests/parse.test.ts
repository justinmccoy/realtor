import { describe, expect, it } from "vitest";
import { linesOf, parseDuration, parseNum, toLines } from "../src/lib/parse";

describe("parseDuration (artifact behavior)", () => {
  it("parses h:mm", () => {
    expect(parseDuration("1:30")).toBe(90);
    expect(parseDuration("0:05")).toBe(5);
  });
  it("parses decimal hours with . or ,", () => {
    expect(parseDuration("1.5")).toBe(90);
    expect(parseDuration("1,5")).toBe(90);
  });
  it("parses h/m combos", () => {
    expect(parseDuration("45m")).toBe(45);
    expect(parseDuration("2h")).toBe(120);
    expect(parseDuration("1,5h 20m")).toBe(110);
    expect(parseDuration("1h 05min")).toBe(65);
  });
  it("rejects junk", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("-5")).toBeNull();
  });
});

describe("parseNum (German thousand separators)", () => {
  it("handles 489.000 and 1,5", () => {
    expect(parseNum("489.000")).toBe(489000);
    expect(parseNum("1,5")).toBe(1.5);
    expect(parseNum("3.57")).toBe(3.57);
    expect(parseNum(" 750 000 ")).toBe(750000);
  });
  it("empty → null", () => {
    expect(parseNum("  ")).toBeNull();
  });
});

describe("lines helpers", () => {
  it("round-trips pros/cons", () => {
    const lines = "Balcony\n\n  Stucco  \n";
    expect(linesOf(lines)).toEqual(["Balcony", "Stucco"]);
    expect(toLines(["a", "b"])).toBe("a\nb");
  });
});
