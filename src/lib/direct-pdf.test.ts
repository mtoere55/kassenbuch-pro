import { describe, expect, it } from "vitest";
import { buildSinglePageJpegPdf } from "./direct-pdf";

describe("direct PDF builder", () => {
  it("wraps a JPEG stream in a valid single-page PDF container", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const pdf = buildSinglePageJpegPdf(jpeg, 1, 1);
    const text = new TextDecoder().decode(pdf);

    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/Subtype /Image");
    expect(text).toContain("/Filter /DCTDecode");
    expect(text).toContain("xref");
    expect(text).toContain("startxref");
    expect(text).toContain("%%EOF");
    expect(pdf.length).toBeGreaterThan(jpeg.length);
  });
});
