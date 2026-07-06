import { describe, expect, it } from "vitest";
import { parseTransactionsCsv } from "./csv";
import {
  preparePayPalBookkeeping,
  reviewPayPalTransaction,
  suggestPayPalAccount,
} from "./paypal-bookkeeping";
import type { AppState, ImportedTransaction } from "./types";

const paypalCsv = `"Datum","Uhrzeit","Zeitzone","Beschreibung","Währung","Brutto","Entgelt","Netto","Guthaben","Transaktionscode","Absender E-Mail-Adresse","Name","Name der Bank","Bankkonto","Versand- und Bearbeitungsgebühr","Umsatzsteuer","Rechnungsnummer","Zugehöriger Transaktionscode"
"02.04.2026","18:12:18","Europe/Berlin","PayPal Express-Zahlung","EUR","-78,11","0,00","-78,11","-78,11","7EC417348N3276424","info@otara.de","otara GmbH","","","5,65","0,00","600517",""
"02.04.2026","18:12:18","Europe/Berlin","Bankgutschrift auf PayPal-Konto","EUR","78,11","0,00","78,11","0,00","0L051738D36369501","","","","","5,65","0,00","600517","7EC417348N3276424"
"27.05.2026","13:02:44","Europe/Berlin","Rückzahlung","EUR","5,45","0,00","5,45","5,45","3XC13788P4745282W","eu_eur_managed_payments@ebay.com","eBay S.a.r.l.","","","0,00","0,00","refund-1","2NK974069T354035P"
"27.05.2026","13:02:44","Europe/Berlin","Von Nutzer eingeleitete Abbuchung","EUR","-5,45","0,00","-5,45","0,00","3GH19965BN462852J","","","","","0,00","0,00","refund-1","2NK974069T354035P"`;

describe("PayPal bookkeeping", () => {
  it("creates an expense, refund and internal transfers without changing cash", () => {
    const transactions = parseTransactionsCsv(paypalCsv, "paypal");
    const result = preparePayPalBookkeeping(makeState(transactions));

    expect(result.createdEntries).toBe(4);
    expect(result.transferEntries).toBe(2);
    expect(result.reviewCount).toBe(2);
    expect(result.state.ledger.every((entry) => entry.cashChange === 0)).toBe(true);

    const expense = result.state.ledger.find((entry) => entry.sourceId === "paypal:7EC417348N3276424");
    expect(expense).toMatchObject({
      direction: "expense",
      amount: 78.11,
      paymentMethod: "paypal",
      accountCode: "3200",
      taxRate: 0,
      counterAccountCode: "1370",
    });

    const funding = result.state.ledger.find((entry) => entry.sourceId === "paypal:0L051738D36369501");
    expect(funding).toMatchObject({
      direction: "transfer",
      accountCode: "1370",
      counterAccountCode: "1200",
    });
  });

  it("does not create duplicate ledger entries on a second run", () => {
    const first = preparePayPalBookkeeping(makeState(parseTransactionsCsv(paypalCsv, "paypal")));
    const second = preparePayPalBookkeeping(first.state);
    expect(second.createdEntries).toBe(0);
    expect(second.state.ledger).toHaveLength(first.state.ledger.length);
  });

  it("applies VAT only after the invoice has been reviewed", () => {
    const prepared = preparePayPalBookkeeping(makeState(parseTransactionsCsv(paypalCsv, "paypal")));
    const transaction = prepared.state.importedTransactions.find(
      (item) => item.externalId === "7EC417348N3276424",
    )!;
    const reviewed = reviewPayPalTransaction(prepared.state, transaction.id, {
      description: "Wareneinkauf otara GmbH",
      accountCode: "3200",
      taxRate: 19,
      direction: "expense",
      paymentMethod: "paypal",
    });
    const entry = reviewed.ledger.find((item) => item.id === transaction.matchedLedgerEntryId);
    expect(entry).toMatchObject({
      taxRate: 19,
      taxAmount: 12.47,
      netAmount: 65.64,
      accountCode: "3200",
    });
    expect(
      reviewed.importedTransactions.find((item) => item.id === transaction.id)?.bookkeepingStatus,
    ).toBe("reviewed");
  });

  it("suggests accounts conservatively by known PayPal vendor", () => {
    expect(suggestPayPalAccount(transaction("Google Ireland Limited"))).toBe("4610");
    expect(suggestPayPalAccount(transaction("softwarenetz.de"))).toBe("4980");
    expect(suggestPayPalAccount(transaction("eBay S.a.r.l."))).toBe("3200");
    expect(suggestPayPalAccount(transaction("Unknown vendor"))).toBe("0000");
  });
});

function transaction(counterparty: string): ImportedTransaction {
  return {
    id: `import-${counterparty}`,
    accountType: "paypal",
    date: "2026-06-01",
    amount: -10,
    description: `PayPal Express-Zahlung · ${counterparty}`,
    counterparty,
    transactionType: "payment",
    matchConfidence: 0,
    status: "new",
    createdAt: "2026-06-01T12:00:00.000Z",
  };
}

function makeState(importedTransactions: ImportedTransaction[]): AppState {
  return {
    version: 1,
    customers: [],
    devices: [],
    purchases: [],
    sales: [],
    documents: [],
    ledger: [],
    importedTransactions,
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
