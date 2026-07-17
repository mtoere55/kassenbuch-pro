import { describe, expect, it } from "vitest";
import { applyBookkeepingRulesSafely } from "./learned-booking-rules";
import type { AppState, ImportedTransaction, LedgerEntry } from "./types";

describe("historical cash deposit repair", () => {
  it("converts an old April bank row into the same Kasse-to-Bank transfer used in later months", () => {
    const state = makeState();
    state.ledger = [oldAprilLedger()];
    state.importedTransactions = [oldAprilTransaction("ledger-april")];

    const repaired = applyBookkeepingRulesSafely(state);

    expect(repaired.ledger).toHaveLength(1);
    expect(repaired.ledger[0]).toMatchObject({
      id: "ledger-april",
      date: "2026-04-07",
      direction: "transfer",
      amount: 870,
      paymentMethod: "bank",
      description: "Umbuchung Kasse an Bank",
      category: "1200 · Bank",
      accountCode: "1200",
      counterAccountCode: "1000",
      cashChange: -870,
      manualKind: "transfer",
      reconciled: true,
    });
    expect(repaired.ledger[0].documentNumber).toMatch(/^UMB-202604-\d{4}$/);
    expect(repaired.importedTransactions[0]).toMatchObject({
      matchedLedgerEntryId: "ledger-april",
      suggestedAccountCode: "1200",
      status: "ignored",
      bookkeepingStatus: "reviewed",
    });
  });

  it("creates the missing cashbook counterpart when the old imported row has no linked ledger entry", () => {
    const state = makeState();
    state.importedTransactions = [oldAprilTransaction(undefined)];

    const repaired = applyBookkeepingRulesSafely(state);

    expect(repaired.ledger).toHaveLength(1);
    expect(repaired.ledger[0]).toMatchObject({
      date: "2026-04-07",
      source: "bankImport",
      sourceId: "sparkasse:4-2026:cash-deposit",
      accountCode: "1200",
      counterAccountCode: "1000",
      cashChange: -870,
    });
    expect(repaired.importedTransactions[0].matchedLedgerEntryId).toBe(repaired.ledger[0].id);
  });

  it("is idempotent and does not create a second April withdrawal", () => {
    const state = makeState();
    state.ledger = [oldAprilLedger()];
    state.importedTransactions = [oldAprilTransaction("ledger-april")];

    const once = applyBookkeepingRulesSafely(state);
    const twice = applyBookkeepingRulesSafely(once);

    expect(twice).toBe(once);
    expect(twice.ledger).toHaveLength(1);
    expect(twice.ledger.reduce((sum, entry) => sum + (entry.cashChange || 0), 0)).toBe(-870);
  });

  it("does not treat an ordinary incoming bank credit as cash deposited from the till", () => {
    const state = makeState();
    state.importedTransactions = [{
      ...oldAprilTransaction(undefined),
      description: "GutschriftÜberweisung · Telefonica sagt Danke",
      counterparty: "Telefonica sagt Danke",
      externalId: "sparkasse:4-2026:commission",
      amount: 125,
    }];

    const result = applyBookkeepingRulesSafely(state);

    expect(result.ledger).toHaveLength(0);
  });
});

function oldAprilTransaction(ledgerId?: string): ImportedTransaction {
  return {
    id: "import-april-cash",
    accountType: "bank",
    date: "2026-04-07",
    amount: 870,
    description: "Bargeldeinzahlung · Einzahlung am SB-Automaten",
    counterparty: "Bargeldeinzahlung",
    externalId: "sparkasse:4-2026:cash-deposit",
    transactionType: "other",
    matchedLedgerEntryId: ledgerId,
    suggestedAccountCode: "0000",
    bookkeepingStatus: "booked",
    matchConfidence: 0,
    status: "needsReview",
    createdAt: "2026-07-15T12:00:00.000Z",
  };
}

function oldAprilLedger(): LedgerEntry {
  return {
    id: "ledger-april",
    date: "2026-04-07",
    direction: "income",
    amount: 870,
    paymentMethod: "bank",
    description: "Bargeldeinzahlung",
    category: "0000 · Nicht zugeordnet",
    source: "bankImport",
    sourceId: "sparkasse:4-2026:cash-deposit",
    documentId: "bank-april",
    taxAmount: 0,
    taxRate: 0,
    taxMode: "taxFree",
    reconciled: false,
    accountCode: "0000",
    counterAccountCode: "1200",
    cashChange: 0,
    netAmount: 870,
    createdAt: "2026-07-15T12:00:00.000Z",
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
    documents: [{
      id: "bank-april",
      documentNumber: "BANK-202604-4-2026",
      type: "zReport",
      date: "2026-04-30",
      amount: 1910.84,
      taxAmount: 0,
      taxMode: "taxFree",
      status: "archived",
      originalFileName: "Kontoauszug-04-2026.pdf",
      metadata: {
        provider: "Sparkasse an Volme und Ruhr",
        reportKind: "Kontoauszug",
        periodStart: "2026-04-01",
        periodEnd: "2026-04-30",
      },
      createdAt: "2026-07-15T12:00:00.000Z",
    }],
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
