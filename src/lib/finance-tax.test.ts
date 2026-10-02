import { describe, expect, it } from "vitest";
import { buildFinanceForecast, estimateIncomeTax2026, estimateTradeTax } from "./finance-tax";
import type { AppState, LedgerEntry } from "./types";

describe("finance tax forecast", () => {
  it("uses the statutory 2026 income tax brackets", () => {
    expect(estimateIncomeTax2026(12_348)).toBe(0);
    expect(estimateIncomeTax2026(20_000)).toBeGreaterThan(0);
    expect(estimateIncomeTax2026(80_000)).toBe(Math.floor(0.42 * 80_000 - 11_135.63));
  });

  it("applies the individual-business trade tax allowance and multiplier", () => {
    expect(estimateTradeTax(24_500, 520)).toEqual({ measure: 0, tax: 0 });
    const result = estimateTradeTax(50_000, 520);
    expect(result.measure).toBe(892.5);
    expect(result.tax).toBe(4641);
  });

  it("keeps transfers and private movements out of profit and VAT", () => {
    const state = emptyState();
    state.ledger.push(
      entry("income", 1190, 190, "8400", "2026-04-10"),
      entry("expense", 595, 95, "3400", "2026-04-11"),
      entry("transfer", 1000, 0, "1200", "2026-04-12"),
      { ...entry("expense", 300, 0, "1800", "2026-04-13"), manualKind: "private" },
    );
    const result = buildFinanceForecast(state, 2026, new Date("2026-10-01T12:00:00Z"));
    expect(result.revenueGross).toBe(1190);
    expect(result.revenueNet).toBe(1000);
    expect(result.expenseGross).toBe(595);
    expect(result.expenseNet).toBe(500);
    expect(result.profit).toBe(500);
    expect(result.outputVat).toBe(190);
    expect(result.inputVat).toBe(95);
    expect(result.vatLiability).toBe(95);
  });

  it("keeps stale legacy clearing rows out even when their direction is wrongly stored as expense", () => {
    const state = emptyState();
    state.ledger.push(
      { ...entry("expense", 1750, 279.41, "1000", "2026-07-01"), manualKind: "transfer", description: "Kasse an Bank" },
      { ...entry("expense", 1750, 279.41, "1590", "2026-07-02"), manualKind: "expense", description: "UniTel Guthaben-Verrechnung" },
      { ...entry("expense", 240, 38.32, "1592", "2026-07-07"), manualKind: "expense", description: "Prifoto 50/50-Verrechnung" },
      { ...entry("expense", 107.87, 17.22, "1370", "2026-07-14"), manualKind: "expense", description: "Bank an PayPal" },
      entry("expense", 121.71, 19.43, "4140", "2026-07-06"),
    );
    const result = buildFinanceForecast(state, 2026, new Date("2026-10-01T12:00:00Z"));
    expect(result.expenseGross).toBe(121.71);
    expect(result.expenseNet).toBe(102.28);
    expect(result.inputVat).toBe(19.43);
  });

  it("excludes a scanned bank statement that was misclassified as a supplier invoice", () => {
    const state = emptyState();
    state.documents.push({
      id: "doc-bank-statement",
      documentNumber: "ER-2026-9999",
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
      entry("income", 1190, 190, "8400", "2026-07-10"),
      entry("expense", 595, 95, "3400", "2026-07-11"),
      {
        ...entry("expense", 20_426, 3261.29, "3400", "2026-07-16"),
        source: "scan",
        documentId: "doc-bank-statement",
        sourceId: "doc-bank-statement",
        description: "Eingangsrechnung Kontoauszug für 01 April 2026 bis 29 Mai 2026",
        netAmount: 17_164.71,
      },
    );

    const result = buildFinanceForecast(state, 2026, new Date("2026-10-01T12:00:00Z"));
    expect(result.revenueNet).toBe(1000);
    expect(result.expenseNet).toBe(500);
    expect(result.profit).toBe(500);
    expect(result.inputVat).toBe(95);
  });

  it("counts PayPal supplier payments without invoice as missing-receipt quality issues", () => {
    const state = emptyState();
    state.ledger.push({
      ...entry("expense", 100, 0, "3400", "2026-07-10"),
      source: "paypalImport",
      note: "Ohne Vorsteuer bis Beleg vorliegt.",
    });
    const result = buildFinanceForecast(state, 2026, new Date("2026-10-01T12:00:00Z"));
    expect(result.quality.missingReceiptEntries).toBe(1);
    expect(result.quality.score).toBeLessThan(100);
  });

  it("subtracts recorded tax prepayments from the recommended reserve", () => {
    const state = emptyState();
    state.settings.vatPrepayments = 100;
    state.settings.incomeTaxPrepayments = 200;
    state.settings.tradeTaxPrepayments = 300;
    state.ledger.push(entry("income", 11900, 1900, "8400", "2026-01-10"));
    const result = buildFinanceForecast(state, 2026, new Date("2026-12-31T12:00:00Z"));
    expect(result.remainingVat).toBe(Math.max(0, result.projectedVatLiability - 100));
    expect(result.recommendedReserve).toBe(
      Math.round((result.remainingVat + result.remainingIncomeTax + result.remainingTradeTax) * 100) / 100,
    );
  });
});

function entry(
  direction: LedgerEntry["direction"],
  amount: number,
  taxAmount: number,
  accountCode: string,
  date: string,
): LedgerEntry {
  return {
    id: Math.random().toString(),
    date,
    direction,
    amount,
    paymentMethod: direction === "transfer" ? "bank" : "cash",
    description: "Test",
    category: `${accountCode} · Test`,
    source: "manual",
    taxAmount,
    taxRate: taxAmount ? 19 : 0,
    taxMode: taxAmount ? "standard19" : "taxFree",
    reconciled: true,
    accountCode,
    counterAccountCode: "1000",
    netAmount: amount - taxAmount,
    cashChange: direction === "income" ? amount : direction === "expense" ? -amount : 0,
    createdAt: `${date}T12:00:00.000Z`,
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
      ownerName: "Ali Sun",
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
      tradeTaxMultiplier: 520,
      otherTaxableIncome: 0,
      vatPrepayments: 0,
      incomeTaxPrepayments: 0,
      tradeTaxPrepayments: 0,
    },
  };
}
