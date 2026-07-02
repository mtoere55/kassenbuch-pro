import { describe, expect, it } from "vitest";
import {
  calculateDifferentialTax,
  calculateSaleMetrics,
  getTaxAmountFromGross,
  isValidImei,
  nextSequence,
} from "./accounting";

describe("accounting core", () => {
  it("calculates §25a VAT only on a positive margin", () => {
    expect(calculateDifferentialTax(400, 250)).toBe(23.95);
    expect(calculateDifferentialTax(200, 250)).toBe(0);
  });

  it("calculates device profit after repair and differential VAT", () => {
    expect(
      calculateSaleMetrics({
        salePrice: 400,
        purchasePrice: 250,
        repairCosts: 20,
        taxMode: "differential",
      }),
    ).toMatchObject({
      grossMargin: 150,
      differentialVat: 23.95,
      profitAfterVatAndRepair: 106.05,
    });
  });

  it("extracts 19 percent VAT from a gross amount", () => {
    expect(getTaxAmountFromGross(230)).toBe(36.72);
  });

  it("validates IMEI using the Luhn checksum", () => {
    expect(isValidImei("490154203237518")).toBe(true);
    expect(isValidImei("490154203237519")).toBe(false);
    expect(isValidImei("123")).toBe(false);
  });

  it("creates the next year-based document number", () => {
    expect(nextSequence("RE", ["RE-2026-0001", "RE-2026-0007"], new Date("2026-07-02"))).toBe(
      "RE-2026-0008",
    );
  });
});
