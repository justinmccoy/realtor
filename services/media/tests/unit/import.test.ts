import { describe, expect, it } from "vitest";
import { sniffImageType } from "../../src/import.js";

function bytes(...head: number[]): Uint8Array {
  const b = new Uint8Array(16);
  b.set(head);
  return b;
}

describe("sniffImageType", () => {
  it("recognises JPEG, PNG and WebP by magic bytes", () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(
      "image/png"
    );
    const webp = bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50);
    expect(sniffImageType(webp)).toBe("image/webp");
  });

  it("rejects anything else", () => {
    expect(sniffImageType(bytes(0x47, 0x49, 0x46, 0x38))).toBeNull(); // GIF
    expect(sniffImageType(new TextEncoder().encode("<html>not an image</html>"))).toBeNull();
    expect(sniffImageType(new Uint8Array(3))).toBeNull();
  });
});
