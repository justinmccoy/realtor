import { describe, expect, it } from "vitest";
import { ApiError } from "../src/errors.js";
import { decodeCursor, encodeCursor } from "../src/pagination.js";

describe("pagination cursor", () => {
  it("round-trips a DynamoDB LastEvaluatedKey", () => {
    const key = { PK: "SEARCH#01J", SK: "LISTING#01K" };
    const cursor = encodeCursor(key);
    expect(cursor).toBeTypeOf("string");
    expect(decodeCursor(cursor!)).toEqual(key);
  });

  it("returns null/undefined at the ends", () => {
    expect(encodeCursor(undefined)).toBeNull();
    expect(decodeCursor(undefined)).toBeUndefined();
  });

  it("rejects tampered cursors with a 400", () => {
    expect(() => decodeCursor("not-base64-json")).toThrowError(ApiError);
    const arr = Buffer.from(JSON.stringify([1, 2]), "utf8").toString("base64url");
    expect(() => decodeCursor(arr)).toThrowError(ApiError);
  });
});
