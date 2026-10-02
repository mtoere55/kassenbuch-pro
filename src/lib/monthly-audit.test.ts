import { describe, expect, it } from "vitest";
import { buildMonthlyAudit } from "./monthly-audit";
import type { AppState, LedgerEntry } from "./types";

describe("monthly finance audit", () => {
  it("summarizes operating entries and keeps transfers out of profit", () => {
    const state = emptyState();
    state.ledger.push(
      entry("income", 1190, "8400", "2026-07-01", { taxAmount: 190, netAmount: 1000 }),
      entry("expense", 595, "3400", "2026-07-02", { taxAmount: 95, netAmount: 500 }),
      entry("transfer", 1000, "1360", "2026-07-03", { cashChange: -1000, description: "Kasse an Bank" }),
    );

    const audit = buildMonthlyAudit(state, "2026-07");
    expect(audit.revenueNet).toBe(1000);
    expect(audit.expenseNet).toBe(500);
    expect(audit.profitNet).toBe(500);
    expect(audit.transferVolume).toBe(1000);
  });

  it("flags unresolved, duplicate and transfer-like misclassified entries", () => {
    const state = emptyState();
    const duplicate = entry("expense", 120, "0000", "2026-07-05", {
      reconciled: false,
      description: "Kasse an Bank",
    });
    state.ledger.push(duplicate, { ...duplicate, id: "duplicate-2", createdAt: "2026-07-05T13:00:00.000Z" });

    const audit = buildMonthlyAudit(state, "2026-07");
    expect(audit.unresolvedCount).toBe(2);
    expect(audit.duplicateGroupCount).toBe(1);
    expect(audit.status).toBe("danger");
    expect(audit.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["unresolved", "duplicates", "transfer-classification"]),
    );
  });

  it("detects days with a negative cash balance", () => {
    const state = emptyState();
    state.settings.openingCash = 100;
    state.ledger.push(
      entry("expense", 150, "4930", "2026-07-10", { cashChange: -150 }),
      entry("income", 100, "8400", "2026-07-11", { cashChange: 100 }),
    );

    const audit = buildMonthlyAudit(state, "2026-07");
    expect(audit.negativeCashDays).toBe(1);
    expect(audit.issues.some((issue) => issue.code === "negative-cash")).toBe(true);
  });

  it("excludes a misclassified bank statement from monthly expenses and flags it clearly", () => {
    const state = emptyState();
    state.documents.push({
      id: "doc-bank-statement",
      documentNumber: "ER-2026-7777",
      type: "supplierInvoice",
      date: "2026-07-16",
      amount: 20_426,
      taxAmount: 3261.29,
      taxMode: "standard19",
      paymentMethod: "bank",
      status: "paid",
      ocrText: "Kontoauszug für 01 April 2026 bis 29 Mai 2026 IBAN DE123 Buchungstag Wertstellung Neuer Kontostand",
      createdAt: "2026-07-16T12:00:00.000Z",
    });
    state.ledger.push(
      entry("income", 1190, "8400", "2026-07-10", { taxAmount: 190, netAmount: 1000 }),
      entry("expense", 595, "3400", "2026-07-11", { taxAmount: 95, netAmount: 500 }),
      {
        ...entry("expense", 20_426, "3400", "2026-07-16", {
          taxAmount: 3261.29,
          netAmount: 17_164.71,
        }),
        source: "scan",
        documentId: "doc-bank-statement",
        sourceId: "doc-bank-statement",
        description: "Eingangsrechnung Kontoauszug für 01 April 2026 bis 29 Mai 2026",
      },
    );

    const audit = buildMonthlyAudit(state, "2026-07");
    expect(audit.expenseNet).toBe(500);
    expect(audit.profitNet).toBe(500);
    expect(audit.inputVat).toBe(95);
    expect(audit.misclassifiedBankStatementCount).toBe(1);
    expect(audit.excludedBankStatementGross).toBe(20_426);
    expect(audit.issues.some((issue) => issue.code === "bank-statement-as-invoice")).toBe(true);
  });

  it("flags a device sale below purchase plus repair cost", () => {
    const state = emptyState();
    state.devices.push({
      id: "d1",
      stockNumber: "GER-2026-0001",
      category: "Smartphone",
      brand: "Apple",
      model: "iPhone",
      imei1: "490154203237518",
      condition: "used",
      status: "sold",
      purchaseId: "p1",
      purchasePrice: 500,
      purchaseDate: "2026-06-01",
      taxMode: "differential",
      repairCosts: 50,
      saleId: "s1",
      salePrice: 525,
      saleDate: "2026-07-12",
      createdAt: "2026-06-01T12:00:00.000Z",
    });

    const audit = buildMonthlyAudit(state, "2026-07");
    expect(audit.belowCostSales).toBe(1);
    expect(audit.issues.some((issue) => issue.code === "below-cost-sale")).toBe(true);
  });
});

function entry(
  direction: LedgerEntry["direction"],
  amount: number,
  accountCode: string,
  date: string,
  patch: Partial<LedgerEntry> = {},
): LedgerEntry {
  return {
    id: `e-${date}-${amount}-${Math.random()}`,
    date,
    direction,
    amount,
    paymentMethod: "cash",
    description: "Test",
    category: `${accountCode} · Test`,
    source: "manual",
    taxAmount: 0,
    taxRate: 0,
    taxMode: "taxFree",
    reconciled: true,
    accountCode,
    counterAccountCode: "1000",
    netAmount: amount,
    cashChange: direction === "income" ? amount : direction === "expense" ? -amount : 0,
    createdAt: `${date}T12:00:00.000Z`,
    ...patch,
  };
}

function emptyState(): AppState {
  return {
    version: 1,
    customers: [],
    devices: [],
    purchases: [],
    sales: [],
    repairs: [],
    documents: [],
    ledger: [],
    importedTransactions: [],
    settings: {
      businessName: "Handyshop Sun-Tel",
      ownerName: "Murat Toere",
      street: "Badstraße 6",
      postalCode: "58095",
      city: "Hagen",
      phone: "",
      email: "",
      taxNumber: "",
      vatId: "",
      iban: "",
      invoicePrefix: "RE",
      receiptPrefix: "QU",
      purchasePrefix: "ANK",
      currency: "EUR",
      language: "de",
      openingCash: 0,
    },
  };
}
