import { describe, expect, it } from "vitest";
import {
  createUnitelCashImportPlan,
  ensurePinSalesHeader,
  parseUnitelCashReport,
} from "./unitel-cash-import";
import type { AppState, LedgerEntry } from "./types";

const HEADERLESS = [
  "Ali Sun\tAY Yıldız 10,00 €\t9,65 €\t10,00 €\t2\t19,30 €\t20,00 €\t0,70 €\t01-04-2026",
  "Ali Sun\tLycaMobile 10 10,00 €\t9,15 €\t10,00 €\t3\t27,45 €\t30,00 €\t2,55 €\t01-04-2026",
  "Ali Sun\tOrtel Aufladekarte 10,00 €\t9,22 €\t10,00 €\t1\t9,22 €\t10,00 €\t0,78 €\t02-04-2026",
  "\tGesamtesumme\t6\t55,97 €\t60,00 €\t4,03 €\t",
  "© 2007 Pin-Sales.de",
].join("\n");

describe("Unitel all-cash import", () => {
  it("accepts the Pin-Sales export without a heading row and validates declared totals", () => {
    expect(ensurePinSalesHeader(HEADERLESS)).toMatch(/^Benutzername\t/);
    const report = parseUnitelCashReport(HEADERLESS);
    expect(report).toMatchObject({
      startDate: "2026-04-01",
      endDate: "2026-04-02",
      lineCount: 3,
      dayCount: 2,
      quantity: 6,
      purchaseTotal: 55.97,
      salesTotal: 60,
      profit: 4.03,
    });
  });

  it("books every new day fully to cash and uses 8403 only for taxable commission", () => {
    const report = parseUnitelCashReport(HEADERLESS);
    const plan = createUnitelCashImportPlan(emptyState(), report, "pinsales.txt");
    const sales = plan.entries.filter((entry) => entry.sourceId?.startsWith("unitel-sales:"));
    const commissions = plan.entries.filter((entry) => entry.sourceId?.startsWith("unitel-commission:"));

    expect(plan.importedDays).toBe(2);
    expect(plan.skippedExistingDays).toBe(0);
    expect(plan.conflicts).toEqual([]);
    expect(sales).toHaveLength(2);
    expect(sales.reduce((sum, entry) => sum + entry.amount, 0)).toBe(60);
    expect(sales.reduce((sum, entry) => sum + (entry.cashChange || 0), 0)).toBe(60);
    expect(sales.every((entry) => entry.paymentMethod === "cash" && entry.accountCode === "1000" && entry.counterAccountCode === "1590")).toBe(true);
    expect(commissions).toHaveLength(1);
    expect(commissions[0]).toMatchObject({ accountCode: "8403", amount: 4.03, taxRate: 19, counterAccountCode: "1590" });
  });

  it("does not duplicate an exact MeinBuch Unitel day and still imports the missing day", () => {
    const state = emptyState();
    state.ledger.push(kasUnitelEntry("2026-04-01", 50));
    const report = parseUnitelCashReport(HEADERLESS);
    const plan = createUnitelCashImportPlan(state, report, "pinsales.txt");

    expect(plan.skippedExistingDays).toBe(1);
    expect(plan.importedDays).toBe(1);
    expect(plan.conflicts).toEqual([]);
    expect(plan.entries.filter((entry) => entry.sourceId?.startsWith("unitel-sales:"))).toEqual([
      expect.objectContaining({ date: "2026-04-02", amount: 10, cashChange: 10 }),
    ]);
  });

  it("blocks automatic booking when an existing Unitel cash day has a different amount", () => {
    const state = emptyState();
    state.ledger.push(kasUnitelEntry("2026-04-01", 40));
    const report = parseUnitelCashReport(HEADERLESS);
    const plan = createUnitelCashImportPlan(state, report, "pinsales.txt");

    expect(plan.conflicts).toEqual([
      { date: "2026-04-01", reportTotal: 50, existingTotal: 40, difference: 10 },
    ]);
    expect(plan.importedDays).toBe(1);
  });
});

function kasUnitelEntry(date: string, amount: number): LedgerEntry {
  return {
    id: `kas-${date}`,
    date,
    direction: "transfer",
    amount,
    paymentMethod: "cash",
    description: "Unitel Guthaben",
    category: "1590 · Durchlaufende Posten / UniTel",
    source: "kasImport",
    sourceId: `kas:test:${date}`,
    taxAmount: 0,
    taxRate: 0,
    taxMode: "taxFree",
    reconciled: true,
    accountCode: "1590",
    counterAccountCode: "1000",
    cashChange: amount,
    netAmount: amount,
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
