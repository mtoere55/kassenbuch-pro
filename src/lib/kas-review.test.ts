import { describe, expect, it } from "vitest";
import {
  buildReviewAccountOptions,
  correctKasEntry,
  isUnresolvedKasEntry,
  ledgerSourceLabel,
  migrateKasImportSources,
} from "./kas-review";
import type { AppState, LedgerEntry } from "./types";

const importedEntry: LedgerEntry = {
  id: "ledger-kas-1",
  date: "2026-06-12",
  direction: "expense",
  amount: 64.99,
  paymentMethod: "cash",
  description: "mediamarkt",
  category: "0000 · Nicht zugeordnet",
  source: "manual",
  sourceId: "kas:15:abc12345",
  taxAmount: 0,
  taxRate: 0,
  taxMode: "taxFree",
  reconciled: true,
  accountCode: "0000",
  counterAccountCode: "1000",
  cashChange: -64.99,
  netAmount: 64.99,
  manualKind: "expense",
  createdAt: "2026-06-12T12:00:00.000Z",
};

describe("KAS review", () => {
  it("recognizes old imported rows and migrates their source", () => {
    expect(isUnresolvedKasEntry(importedEntry)).toBe(true);
    expect(ledgerSourceLabel(importedEntry)).toBe("KAS-Import");

    const state = makeState([importedEntry]);
    const migrated = migrateKasImportSources(state);
    expect(migrated.ledger[0].source).toBe("kasImport");
    expect(migrated.version).toBe(2);
  });

  it("reassigns an unresolved cash expense and recalculates input tax", () => {
    const accounts = buildReviewAccountOptions([importedEntry]);
    const corrected = correctKasEntry(
      importedEntry,
      {
        date: "2026-06-12",
        description: "Druckerpapier",
        amount: 64.99,
        direction: "expense",
        paymentMethod: "cash",
        accountCode: "4930",
        taxRate: 19,
      },
      accounts,
    );

    expect(corrected).toMatchObject({
      accountCode: "4930",
      source: "kasImport",
      taxMode: "standard19",
      taxAmount: 10.38,
      netAmount: 54.61,
      cashChange: -64.99,
    });
    expect(isUnresolvedKasEntry(corrected)).toBe(false);
  });

  it("keeps differential taxation without calculating VAT on the full sale", () => {
    const accounts = buildReviewAccountOptions([importedEntry]);
    const corrected = correctKasEntry(
      importedEntry,
      {
        date: "2026-06-23",
        description: "iPhone 13 Pro",
        amount: 350,
        direction: "income",
        paymentMethod: "cash",
        accountCode: "8390",
        taxRate: 0,
      },
      accounts,
    );

    expect(corrected.taxMode).toBe("differential");
    expect(corrected.taxAmount).toBe(0);
    expect(corrected.cashChange).toBe(350);
  });

  it("does not accept account 0000 as a completed review", () => {
    const accounts = buildReviewAccountOptions([importedEntry]);
    expect(() =>
      correctKasEntry(
        importedEntry,
        {
          date: importedEntry.date,
          description: importedEntry.description,
          amount: importedEntry.amount,
          direction: "expense",
          paymentMethod: "cash",
          accountCode: "0000",
          taxRate: 0,
        },
        accounts,
      ),
    ).toThrow(/gültiges Buchungskonto/);
  });
});

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
      businessName: "Test",
      ownerName: "Test",
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
