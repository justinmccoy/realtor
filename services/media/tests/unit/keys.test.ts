import { describe, expect, it } from "vitest";
import { mediaKeys, photoS3Key } from "../../src/keys.js";

const SID = "01JD4WPKXK8Z1Q2W3E4R5T6Y7V";
const LID = "01JD4WPKXK8Z1Q2W3E4R5T6Y00";
const PID = "01JD4WPKXK8Z1Q2W3E4R5T6Y01";

describe("photoS3Key", () => {
  it("maps content types to extensions and namespaces by search/listing", () => {
    expect(photoS3Key(SID, LID, PID, "image/jpeg")).toBe(
      `searches/${SID}/listings/${LID}/${PID}.jpg`
    );
    expect(photoS3Key(SID, LID, PID, "image/png")).toMatch(/\.png$/);
    expect(photoS3Key(SID, LID, PID, "image/webp")).toMatch(/\.webp$/);
    expect(photoS3Key(SID, LID, PID, "application/octet-stream")).toMatch(/\.bin$/);
  });
});

describe("mediaKeys", () => {
  it("photo GSI partitions per search and sorts by listing", () => {
    expect(mediaKeys.photoGsi(SID, LID, PID)).toEqual({
      GSI1PK: `SEARCH#${SID}`,
      GSI1SK: `PHOTO#${LID}#${PID}`
    });
    expect(mediaKeys.listingMeta(LID)).toEqual({
      PK: `LISTING#${LID}`,
      SK: "META"
    });
  });
});
