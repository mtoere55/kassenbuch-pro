import { describe, expect, it } from "vitest";
import {
  applyBookkeepingRulesSafely,
  createLearnedBookingRule,
  getLearnedBookingRules,
  upsertLearnedBookingRule,
} from "./learned-booking-rules";
import type { AppState, ImportedTransaction, LedgerEntry } from "./types";

describe("learned bank booking rules", () => {
  it("learns an unknown supplier and automatically assigns future outgoing rows", () => {
    const state = makeState();
    state.ledger = [bankLedger("ledger-1", "Unbekannter Lieferant", -119)];
    state.importedTransactions = [bankTransaction("import-1", "ledger-1", "Neue Teile GmbH", -119)];

    const rule = createLearnedBookingRule(state.importedTransactions[0], {
      keyword: "Neue Teile GmbH",
      label: "Telefonteile Neue Teile GmbH",
      accountCode: "3400",
      direction: "expense",
      paymentMethod: "bank",
      taxRate: 19,
      documentRequired: true,
    });
    const withRule = upsertLearnedBookingRule(state, rule);
    const result = applyBookkeepingRulesSafely(withRule);

    expect(getLearnedBookingRules(result)).toHaveLength(1);
    expect(result.ledger[0]).toMatchObject({
      accountCode: "3400",
      counterAccountCode: "1200",
      documentNumber: "BANK-202604-0001",
      taxRate: 0,
      taxAmount: 0,
      reconciled: false,
    });
    expect(result.importedTransactions[0]).toMatchObject({
      suggestedAccountCode: "3400",
      status: "needsReview",
      bookkeepingStatus: "booked",
    });
  });

  it("keeps a manually reviewed tax assignment instead of overwriting it with built-in rules", () => {
    const state = makeState();
    state.ledger = [{
      ...bankLedger("ledger-aswo", "ASWO International Service GmbH", -148.23),
      accountCode: "3400",
      counterAccountCode: "1200",
      category: "3400 · Ersatzteile und Reparaturmaterial",
      taxRate: 19,
      taxAmount: 23.67,
      taxMode: "standard19",
      netAmount: 124.56,
      reconciled: true,
      note: "Bank-PDF-Buchung manuell geprüft",
    }];
    state.importedTransactions = [{
      ...bankTransaction("import-aswo", "ledger-aswo", "ASWO International Service GmbH", -148.23),
      suggestedAccountCode: "3400",
      status: "matched",
      bookkeepingStatus: "reviewed",
    }];

    const result = applyBookkeepingRulesSafely(state);
    expect(result).toBe(state);
    expect(result.ledger[0]).toMatchObject({
      taxRate: 19,
      taxAmount: 23.67,
      netAmount: 124.56,
      reconciled: true,
    });
  });

  it("applies learned private rules without creating an expense", () => {
    const state = makeState();
    state.ledger = [bankLedger("ledger-private", "Familienzahlung", -500)];
    state.importedTransactions = [bankTransaction("import-private", "ledger-private", "Familie Beispiel", -500)];
    const rule = createLearnedBookingRule(state.importedTransactions[0], {
      keyword: "Familie Beispiel",
      label: "Private Familienzahlung",
      accountCode: "1800",
      direction: "transfer",
      paymentMethod: "bank",
      taxRate: 0,
      documentRequired: false,
    });

    const result = applyBookkeepingRulesSafely(upsertLearnedBookingRule(state, rule));
    expect(result.ledger[0]).toMatchObject({
      direction: "transfer",
      manualKind: "private",
      accountCode: "1800",
      counterAccountCode: "1200",
      documentNumber: "UMB-202604-0001",
      taxAmount: 0,
    });
    expect(result.importedTransactions[0]).toMatchObject({
      status: "matched",
      bookkeepingStatus: "reviewed",
    });
  });
});

function bankTransaction(
  id: string,
  ledgerId: string,
  counterparty: string,
  amount: number,
): ImportedTransaction {
  return {
    id,
    accountType: "bank",
    date: "2026-04-08",
    amount,
    description: `Überweisung · ${counterparty}`,
    counterparty,
    transactionType: "other",
    matchedLedgerEntryId: ledgerId,
    suggestedAccountCode: "0000",
    bookkeepingStatus: "booked",
    matchConfidence: 0,
    status: "needsReview",
    createdAt: "2026-07-15T12:00:00.000Z",
  };
}

function bankLedger(id: string, description: string, signedAmount: number): LedgerEntry {
  return {
    id,
    date: "2026-04-08",
    direction: signedAmount < 0 ? "expense" : "income",
    amount: Math.abs(signedAmount),
    paymentMethod: "bank",
    description,
    category: "0000 · Nicht zugeordnet",
    source: "bankImport",
    sourceId: `sparkasse:test:${id}`,
    documentId: "bank-document",
    taxAmount: 0,
    taxRate: 0,
    taxMode: "taxFree",
    reconciled: false,
    accountCode: "0000",
    counterAccountCode: "1200",
    cashChange: 0,
    netAmount: Math.abs(signedAmount),
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
    documents: [],
    ledger: [],
    importedTransactions: [],
    settings: {
      businessName: "Suntel Handy Shop",
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
