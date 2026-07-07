import { describe, expect, it } from "vitest";
import { resolveBookkeepingRule } from "./bookkeeping-rules";

describe("fixed bookkeeping rules", () => {
  it.each(["ASWO", "ASBO", "otara GmbH", "MAS Trade"])(
    "books %s as repair parts with 19 percent",
    (name) => {
      expect(resolveBookkeepingRule({ name, context: "supplierInvoice" })).toMatchObject({
        accountCode: "3400",
        taxRate: 19,
        direction: "expense",
      });
    },
  );

  it("books Lyca SIM cards with 19 percent", () => {
    expect(resolveBookkeepingRule({ name: "Lycamobile", context: "supplierInvoice" })).toMatchObject({
      accountCode: "3430",
      taxRate: 19,
    });
  });

  it("keeps UniTel daily money tax free and taxes only monthly commission", () => {
    expect(resolveBookkeepingRule({ name: "UniTel", context: "cashSale" })).toMatchObject({
      accountCode: "1590",
      taxRate: 0,
      direction: "income",
    });
    expect(resolveBookkeepingRule({ name: "UniTel", text: "Provisionsabrechnung", context: "supplierInvoice" })).toMatchObject({
      accountCode: "8510",
      taxRate: 19,
    });
  });

  it("keeps Prifoto daily money tax free and handles monthly settlement", () => {
    expect(resolveBookkeepingRule({ name: "Prifoto", context: "cashSale" })).toMatchObject({
      accountCode: "1591",
      taxRate: 0,
    });
    expect(resolveBookkeepingRule({ name: "Prifoto", text: "Monatsabrechnung", context: "supplierInvoice" })).toMatchObject({
      accountCode: "8510",
      taxRate: 19,
    });
  });
});
