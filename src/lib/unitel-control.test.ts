import { describe, expect, it } from "vitest";
import { buildUnitelDocumentControl } from "./unitel-control";
import type { BusinessDocument, LedgerEntry } from "./types";

const document: BusinessDocument = {
  id: "doc",
  documentNumber: "UNITEL-ME17081",
  type: "zReport",
  date: "2026-05-01",
  amount: 6792.5,
  taxAmount: 65.81,
  taxMode: "standard19",
  status: "archived",
  metadata: {
    provider: "UniTel",
    reportKind: "Guthaben-Monatsabrechnung",
    periodStart: "2026-04-01",
    periodEnd: "2026-04-30",
    invoiceNumber: "ME17081",
    invoiceDate: "2026-05-01",
    totalCardValue: 6792.5,
    commissionGross: 412.15,
    commissionVat: 65.81,
    commissionNet: 346.34,
    payableAmount: 6380.35,
  },
  createdAt: "2026-05-01T00:00:00.000Z",
};

function sales(id: string, date: string, amount: number, paymentMethod: "cash" | "card"): LedgerEntry {
  return {
    id,
    date,
    direction: "transfer",
    amount,
    paymentMethod,
    description: "UniTel Guthaben Tagesumsatz",
    category: "1590 · Durchlaufende Posten / UniTel",
    source: "unitelImport",
    sourceId: `unitel-sales:file:${date}:${paymentMethod}`,
    taxAmount: 0,
    taxRate: 0,
    taxMode: "taxFree",
    reconciled: true,
    accountCode: paymentMethod === "cash" ? "1000" : "1360",
    counterAccountCode: "1590",
    cashChange: paymentMethod === "cash" ? amount : 0,
    createdAt: `${date}T12:00:00.000Z`,
  };
}

describe("live UniTel control", () => {
  it("recalculates a monthly document from cash and card sales entries", () => {
    const control = buildUnitelDocumentControl(document, [
      sales("a", "2026-04-01", 4000, "cash"),
      sales("b", "2026-04-15", 2792.5, "card"),
    ]);
    expect(control).toMatchObject({
      recognizedEntries: 2,
      ledgerTotal: 6792.5,
      difference: 0,
      exact: true,
    });
  });
});
