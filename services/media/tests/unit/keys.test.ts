import { describe, expect, it } from "vitest";
import { mediaKeys, photoS3Key } from "../../src/keys.js";

const LID = "01JD4WPKXK8Z1Q2W3E4R5T6Y00";
const PID = "01JD4WPKXK8Z1Q2W3E4R5T6Y01";

describe("photoS3Key", () => {
  it("maps content types to extensions and namespaces by listing", () => {
    expect(photoS3Key(LID, PID, "image/jpeg")).toBe(
      `listings/${LID}/${PID}.jpg`
    );
    expect(photoS3Key(LID, PID, "image/png")).toMatch(/\.png$/);
    expect(photoS3Key(LID, PID, "image/webp")).toMatch(/\.webp$/);
    expect(photoS3Key(LID, PID, "application/octet-stream")).toMatch(/\.bin$/);
  });
});

describe("mediaKeys", () => {
  it("keys photos and meta under the listing partition", () => {
    expect(mediaKeys.photo(LID, PID)).toEqual({
      PK: `LISTING#${LID}`,
      SK: `PHOTO#${PID}`
    });
    expect(mediaKeys.listingMeta(LID)).toEqual({
      PK: `LISTING#${LID}`,
      SK: "META"
    });
  });
});
