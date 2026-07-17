import { describe, expect, it } from "vitest";
import {
  APRIL_2026_OPENING_CASH,
  calculateOpeningCashAtApril2026,
  ensureApril2026OpeningCash,
} from "./cash-opening-balance";
import type { AppState, LedgerEntry } from "./types";

describe("April 2026 cash opening balance", () => {
  it("sets the carried balance on 1 April 2026 to exactly 625.04 euros", () => {
    const state = makeState();
    state.ledger.push(
      entry("before-income", "2026-03-10", 50),
      entry("before-expense", "2026-03-20", -25),
      entry("april-entry", "2026-04-01", 100),
    );

    const repaired = ensureApril2026OpeningCash(state);

    expect(repaired.settings.openingCash).toBe(600.04);
    expect(calculateOpeningCashAtApril2026(repaired)).toBe(APRIL_2026_OPENING_CASH);
  });

  it("is idempotent and does not add a ledger booking", () => {
    const state = makeState();
    state.ledger.push(entry("before", "2026-03-31", 20));
    const once = ensureApril2026OpeningCash(state);
    const twice = ensureApril2026OpeningCash(once);

    expect(twice).toBe(once);
    expect(twice.ledger).toHaveLength(1);
    expect(calculateOpeningCashAtApril2026(twice)).toBe(625.04);
  });
});

function entry(id: string, date: string, cashChange: number): LedgerEntry {
  return {
    id,
    date,
    direction: cashChange >= 0 ? "income" : "expense",
    amount: Math.abs(cashChange),
    paymentMethod: "cash",
    description: id,
    category: "1000 · Kasse",
    source: "manual",
    sourceId: id,
    taxAmount: 0,
    taxRate: 0,
    taxMode: "taxFree",
    reconciled: true,
    accountCode: "1000",
    cashChange,
    createdAt: `${date}T12:00:00.000Z`,
  };
}

function makeState(): AppState {
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
      openingCash: 100,
    },
  };
}
