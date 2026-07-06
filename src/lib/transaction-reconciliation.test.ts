import { describe, expect, it } from "vitest";
import { reconcileImportedState } from "./transaction-reconciliation";
import type { AppState } from "./types";

function stateWithPayPalPayment(): AppState {
  return {
    version: 1,
    customers: [],
    devices: [],
    purchases: [],
    sales: [],
    documents: [
      {
        id: "doc-1",
        documentNumber: "ER-2026-0001",
        type: "supplierInvoice",
        date: "2026-06-27",
        amount: 64.18,
        taxAmount: 10.25,
        taxMode: "standard19",
        paymentMethod: "paypal",
        status: "paid",
        metadata: { vendor: "Print-Klex" },
        createdAt: "2026-06-27T12:00:00.000Z",
      },
    ],
    ledger: [
      {
        id: "ledger-1",
        date: "2026-06-27",
        direction: "expense",
        amount: 64.18,
        paymentMethod: "paypal",
        description: "Eingangsrechnung Print-Klex",
        category: "4980 · Sonstiger Betriebsbedarf",
        source: "scan",
        sourceId: "doc-1",
        documentId: "doc-1",
        taxAmount: 10.25,
        taxRate: 19,
        taxMode: "standard19",
        reconciled: false,
        createdAt: "2026-06-27T12:00:00.000Z",
      },
    ],
    importedTransactions: [
      {
        id: "import-1",
        accountType: "paypal",
        date: "2026-06-27",
        amount: -64.18,
        description: "PayPal Express-Zahlung · eBay S.a.r.l.",
        externalId: "5UH49547H6232962H",
        transactionType: "payment",
        counterparty: "eBay S.a.r.l.",
        matchConfidence: 0,
        status: "new",
        createdAt: "2026-07-06T02:34:44.000Z",
      },
      {
        id: "import-2",
        accountType: "paypal",
        date: "2026-06-27",
        amount: 64.18,
        description: "Umbuchung Bank → PayPal",
        externalId: "5GC50894GM949750D",
        transactionType: "bankFunding",
        matchConfidence: 0,
        status: "ignored",
        createdAt: "2026-07-06T02:34:44.000Z",
      },
    ],
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

describe("imported transaction reconciliation", () => {
  it("matches a PayPal expense with the supplier invoice and ledger entry", () => {
    const state = stateWithPayPalPayment();
    state.importedTransactions = [
      {
        id: "import-1",
        accountType: "paypal",
        date: "2026-06-27",
        amount: -64.18,
        description: "PayPal Express-Zahlung · eBay S.a.r.l.",
        transactionType: "payment",
        matchConfidence: 0,
        status: "new",
        createdAt: "2026-07-06T02:34:44.000Z",
      },
    ];
    const result = reconcileImportedState(state);
    expect(result.matched).toBe(1);
    expect(result.state.importedTransactions[0]).toMatchObject({
      status: "matched",
      matchedDocumentId: "doc-1",
      matchedLedgerEntryId: "ledger-1",
      matchConfidence: 90,
    });
    expect(result.state.ledger[0].reconciled).toBe(true);
  });

  it("does not match internal PayPal funding rows as revenue", () => {
    const state = stateWithPayPalPayment();
    state.importedTransactions = [
      {
        id: "import-2",
        accountType: "paypal",
        date: "2026-06-27",
        amount: 64.18,
        description: "Umbuchung Bank → PayPal",
        transactionType: "bankFunding",
        matchConfidence: 0,
        status: "ignored",
        createdAt: "2026-07-06T02:34:44.000Z",
      },
    ];
    const result = reconcileImportedState(state);
    expect(result.matched).toBe(0);
    expect(result.state.importedTransactions[0].status).toBe("ignored");
  });
});
