import { describe, expect, it } from "vitest";
import { parseDecimal, validateSupplierInvoiceAmounts } from "./invoice-validation";

describe("supplier invoice amount validation", () => {
  it("accepts a normal 19 percent invoice", () => {
    expect(validateSupplierInvoiceAmounts(495.21, 79.07)).toEqual({
      gross: 495.21,
      vat: 79.07,
      net: 416.14,
      vatRate: 19,
    });
  });

  it("accepts a normal 7 percent invoice", () => {
    expect(validateSupplierInvoiceAmounts(107, 7).vatRate).toBe(7);
  });

  it("blocks OCR output where tax equals gross", () => {
    expect(() => validateSupplierInvoiceAmounts(495.21, 495.21)).toThrow(
      /gleich hoch oder höher/,
    );
  });

  it("blocks tax above the amount included at 19 percent", () => {
    expect(() => validateSupplierInvoiceAmounts(119, 25)).toThrow(/höchstens 19.00/);
  });

  it("parses formatted decimals", () => {
    expect(parseDecimal("1.234,56")).toBe(1234.56);
  });
});
