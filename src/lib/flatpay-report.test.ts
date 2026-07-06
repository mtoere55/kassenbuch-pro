import { describe, expect, it } from "vitest";
import { getTaxAmountFromGross } from "./accounting";
import {
  compareFlatpayReportToLedger,
  createFlatpayImportPlan,
  parseFlatpaySalesReport,
  validateFlatpaySalesReport,
} from "./flatpay-report";
import type { AppState, LedgerEntry } from "./types";

const reportText = `UMSATZBERICHT
Handyshop Sun-Tel
Flatpay ApS
Zeitraum: 01.04.26 bis 30.06.26
Verkauf:
Bargeld 3.626,50
Karte 7.307,75
Andere 0,00
Erstattungen:
Bargeld 0,00
Karte 0,00
Andere 0,00
Gesamtumsatz: 10.934,25
Trinkgelder: 0,00
Surcharge: 8,47
MwSt.-Satz Nettobetrag MwSt. Betrag Brutto Betrag
0,00 % 491,50 0,00 491,50
19,00 % 8.775,42 1.667,33 10.442,75`;

describe("Flatpay PDF report", () => {
  it("parses and validates the real report totals", () => {
    const report = parseFlatpaySalesReport(reportText);
    expect(report).toMatchObject({
      startDate: "2026-04-01",
      endDate: "2026-06-30",
      cashSales: 3626.5,
      cardSales: 7307.75,
      totalSales: 10934.25,
      zeroGross: 491.5,
      standardNet: 8775.42,
      standardVat: 1667.33,
      standardGross: 10442.75,
      surcharge: 8.47,
    });
    expect(validateFlatpaySalesReport(report)).toEqual({ valid: true, issues: [] });
  });

  it("archives without duplicate postings when ledger totals already match", () => {
    const report = parseFlatpaySalesReport(reportText);
    const ledger = matchingLedger();
    const comparison = compareFlatpayReportToLedger(report, ledger);
    expect(comparison.exact).toBe(true);

    const plan = createFlatpayImportPlan(
      makeState(ledger),
      report,
      { zeroCash: 491.5, zeroCard: 0 },
      "Umsatzbericht.pdf",
    );
    expect(plan.entries).toHaveLength(0);
    expect(plan.alreadyMatched).toBe(true);
    expect(plan.document.metadata?.matchedExistingLedger).toBe(true);
  });

  it("creates only missing summary postings and keeps cash/card separate", () => {
    const report = parseFlatpaySalesReport(reportText);
    const plan = createFlatpayImportPlan(
      makeState([]),
      report,
      { zeroCash: 491.5, zeroCard: 0 },
      "Umsatzbericht.pdf",
    );
    expect(plan.entries).toHaveLength(3);
    expect(plan.entries.map((entry) => [entry.paymentMethod, entry.taxRate, entry.amount])).toEqual([
      ["cash", 0, 491.5],
      ["cash", 19, 3135],
      ["card", 19, 7307.75],
    ]);
    expect(plan.entries.reduce((sum, entry) => sum + entry.amount, 0)).toBe(10934.25);
    expect(plan.entries.filter((entry) => entry.paymentMethod === "cash").reduce((sum, entry) => sum + (entry.cashChange || 0), 0)).toBe(3626.5);
    expect(plan.entries.find((entry) => entry.paymentMethod === "card")?.cashChange).toBe(0);
  });

  it("blocks an incomplete 0 percent allocation", () => {
    const report = parseFlatpaySalesReport(reportText);
    expect(() =>
      createFlatpayImportPlan(
        makeState([]),
        report,
        { zeroCash: 0, zeroCard: 0 },
        "Umsatzbericht.pdf",
      ),
    ).toThrow(/Aufteilung der 0-%-Umsätze/);
  });
});

function matchingLedger(): LedgerEntry[] {
  return [
    entry("cash-0", "cash", 491.5, 0, 0, "8600"),
    entry("cash-19", "cash", 3135, 19, getTaxAmountFromGross(3135, 19), "8400"),
    entry("card-19", "card", 7307.75, 19, getTaxAmountFromGross(7307.75, 19), "8400"),
  ];
}

function entry(
  id: string,
  paymentMethod: "cash" | "card",
  amount: number,
  taxRate: number,
  taxAmount: number,
  accountCode: string,
): LedgerEntry {
  return {
    id,
    date: "2026-06-30",
    direction: "income",
    amount,
    paymentMethod,
    description: "Umsatz",
    category: `${accountCode} · Erlöse`,
    source: "manual",
    taxAmount,
    taxRate,
    taxMode: taxRate ? "standard19" : "taxFree",
    reconciled: true,
    accountCode,
    cashChange: paymentMethod === "cash" ? amount : 0,
    netAmount: amount - taxAmount,
    createdAt: "2026-06-30T12:00:00.000Z",
  };
}

function makeState(ledger: LedgerEntry[]): AppState {
  return {
    version: 1,
    customers: [],
    devices: [],
    purchases: [],
    sales: [],
    documents: [],
    ledger,
    importedTransactions: [],
    settings: {
      businessName: "Handyshop Sun-Tel",
      ownerName: "Murat Toere",
      street: "",
      postalCode: "",
      city: "",
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
