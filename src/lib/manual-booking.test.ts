import { describe, expect, it } from "vitest";
import { entryCashEffect, matchesCashbookPaymentFilter } from "./manual-booking";
import type { LedgerEntry } from "./types";

describe("cashbook payment filter", () => {
  it("shows a cash-to-bank transfer imported from a bank statement", () => {
    const entry = makeEntry({
      paymentMethod: "bank",
      direction: "transfer",
      description: "Umbuchung Kasse an Bank",
      accountCode: "1200",
      counterAccountCode: "1000",
      cashChange: -870,
      manualKind: "transfer",
    });

    expect(entryCashEffect(entry)).toBe(-870);
    expect(matchesCashbookPaymentFilter(entry, "cash")).toBe(true);
    expect(matchesCashbookPaymentFilter(entry, "bank")).toBe(true);
  });

  it("keeps ordinary bank payments out of the default cashbook view", () => {
    const entry = makeEntry({
      paymentMethod: "bank",
      direction: "expense",
      description: "Telefonrechnung",
      cashChange: 0,
    });

    expect(matchesCashbookPaymentFilter(entry, "cash")).toBe(false);
    expect(matchesCashbookPaymentFilter(entry, "bank")).toBe(true);
  });

  it("shows ordinary cash income and cash expense", () => {
    expect(matchesCashbookPaymentFilter(makeEntry({ paymentMethod: "cash", direction: "income", amount: 20, cashChange: 20 }), "cash")).toBe(true);
    expect(matchesCashbookPaymentFilter(makeEntry({ paymentMethod: "cash", direction: "expense", amount: 10, cashChange: -10 }), "cash")).toBe(true);
  });
});

function makeEntry(patch: Partial<LedgerEntry>): LedgerEntry {
  return {
    id: "ledger-test",
    date: "2026-04-07",
    direction: "transfer",
    amount: 1,
    paymentMethod: "bank",
    description: "Test",
    category: "1200 · Bank",
    source: "bankImport",
    sourceId: "sparkasse:4-2026:test",
    taxAmount: 0,
    taxRate: 0,
    taxMode: "taxFree",
    reconciled: true,
    accountCode: "1200",
    counterAccountCode: "1000",
    cashChange: -1,
    createdAt: "2026-04-07T12:00:00.000Z",
    ...patch,
  };
}
