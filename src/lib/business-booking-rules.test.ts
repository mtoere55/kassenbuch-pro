import { describe, expect, it } from "vitest";
import {
  applyConfiguredBusinessRules,
  createPeriodBookingNumberAllocator,
  resolveConfiguredBankRule,
  resolveConfiguredKasRule,
} from "./business-booking-rules";
import type { AppState, LedgerEntry } from "./types";

describe("configured business bookkeeping rules", () => {
  it("separates owner health insurance from employee social insurance", () => {
    expect(resolveConfiguredBankRule("AOK NORDWEST DIE GESUNDHEITSKASSE", -316.56)).toMatchObject({
      accountCode: "1800",
      direction: "transfer",
      internalTransfer: true,
      documentRequired: false,
    });
    expect(resolveConfiguredBankRule("IKK classic Beitraege 01.04.2026", -303.41)).toMatchObject({
      accountCode: "4130",
      direction: "expense",
      internalTransfer: false,
      documentRequired: false,
    });
  });

  it("books the configured family payment and employee salary", () => {
    expect(resolveConfiguredBankRule("Gülbahar Sun privat", -1200)).toMatchObject({
      accountCode: "1800",
      manualKind: "private",
    });
    expect(resolveConfiguredBankRule("MURAT TOERE Gehalt", -759.22)).toMatchObject({
      accountCode: "4120",
      classification: "salary",
    });
  });

  it("uses clearing accounts for UniTel, Prifoto, Flatpay and cash deposits", () => {
    expect(resolveConfiguredBankRule("UniTel Guthaben Aufladekarte", -1200)).toMatchObject({ accountCode: "1590", internalTransfer: true });
    expect(resolveConfiguredBankRule("Prifoto GmbH ReNr RE-010320263003", -301)).toMatchObject({ accountCode: "1592", internalTransfer: true });
    expect(resolveConfiguredBankRule("SHIFT4 LIMITED Flatpay", 299)).toMatchObject({ accountCode: "1200", counterAccountCode: "1360", internalTransfer: true });
    expect(resolveConfiguredBankRule("Bargeldeinzahlung SB", 800)).toMatchObject({ accountCode: "1200", counterAccountCode: "1000", cashEffect: "deposit" });
  });

  it("assigns commissions, Google revenue and parts suppliers", () => {
    expect(resolveConfiguredBankRule("Telefonica sagt Danke", 152.93)).toMatchObject({ accountCode: "8403", recommendedTaxRate: 19, documentRequired: true });
    expect(resolveConfiguredBankRule("Ortel sagt Danke", 24.92)).toMatchObject({ accountCode: "8403", documentRequired: true });
    expect(resolveConfiguredBankRule("DPD Deutschland GmbH", 81.99)).toMatchObject({ accountCode: "8403", documentRequired: true });
    expect(resolveConfiguredBankRule("Google Ireland Limited AdSense", 0.92)).toMatchObject({ accountCode: "8338", recommendedTaxRate: 0 });
    expect(resolveConfiguredBankRule("ASWO International Service GmbH", -148.23)).toMatchObject({ accountCode: "3400", documentRequired: true });
    expect(resolveConfiguredBankRule("Ihr Einkauf bei eBay S.a.r.l.", -28)).toMatchObject({ accountCode: "3400", documentRequired: true });
  });

  it("maps legacy KAS clearing rows without manual review", () => {
    expect(resolveConfiguredKasRule({ categoryCode: 1591, description: "Ria Money Transfer", signedAmount: 1000, taxRate: 0 })).toMatchObject({ accountCode: "1591", direction: "transfer" });
    expect(resolveConfiguredKasRule({ categoryCode: 15911, description: "Ria Auszahlung", signedAmount: -900, taxRate: 0 })).toMatchObject({ accountCode: "1591", direction: "transfer" });
    expect(resolveConfiguredKasRule({ categoryCode: 8401, description: "Prifoto", signedAmount: 50, taxRate: 19 })).toMatchObject({ accountCode: "1592", taxRate: 0 });
    expect(resolveConfiguredKasRule({ categoryCode: 0, description: "@telcom Ersatzteil", signedAmount: -119, taxRate: 19 })).toMatchObject({ accountCode: "3400", taxRate: 19 });
  });

  it("creates stable monthly booking-number sequences", () => {
    const allocate = createPeriodBookingNumberAllocator("BANK", [
      { documentNumber: "BANK-202604-0002" },
      { documentNumber: "BANK-202605-0007" },
    ]);
    expect(allocate("2026-04-30")).toBe("BANK-202604-0003");
    expect(allocate("2026-04-30")).toBe("BANK-202604-0004");
    expect(allocate("2026-05-01")).toBe("BANK-202605-0008");
  });

  it("rebooks an imported bank row automatically and marks only the missing document", () => {
    const state = makeState();
    state.ledger = [bankLedger("ledger-aswo", "ASWO International Service GmbH", -148.23)];
    state.importedTransactions = [{
      id: "bank-aswo",
      accountType: "bank",
      date: "2026-04-08",
      amount: -148.23,
      description: "Überweisung o.Beleg · ASWO International Service GmbH",
      counterparty: "ASWO International Service GmbH",
      transactionType: "other",
      matchedLedgerEntryId: "ledger-aswo",
      suggestedAccountCode: "0000",
      bookkeepingStatus: "booked",
      matchConfidence: 0,
      status: "needsReview",
      createdAt: "2026-07-15T12:00:00.000Z",
    }];

    const result = applyConfiguredBusinessRules(state);
    expect(result.ledger[0]).toMatchObject({
      accountCode: "3400",
      counterAccountCode: "1200",
      documentNumber: "BANK-202604-0001",
      taxRate: 0,
      reconciled: false,
    });
    expect(result.importedTransactions[0]).toMatchObject({
      suggestedAccountCode: "3400",
      status: "needsReview",
      bookkeepingStatus: "booked",
    });
  });
});

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
    documentNumber: "BANK-202604-4-2026",
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
