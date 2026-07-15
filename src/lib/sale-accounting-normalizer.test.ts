import { describe, expect, it } from "vitest";
import { normalizeSaleAccountingState } from "./sale-accounting-normalizer";
import type { AppState, BusinessDocument, Device, LedgerEntry, Sale } from "./types";

describe("sale accounting normalization", () => {
  it("posts a cash differential sale to Kasse and stores internal section 25a details", () => {
    const state = makeSaleState({
      taxMode: "differential",
      paymentMethod: "cash",
      purchasePrice: 250,
      repairCosts: 20,
      salePrice: 400,
    });

    const result = normalizeSaleAccountingState(state);
    expect(result.ledger[0]).toMatchObject({
      date: "2026-04-15",
      amount: 400,
      paymentMethod: "cash",
      accountCode: "8336",
      counterAccountCode: "1000",
      documentNumber: "RE-2026-0001",
      groupId: "sale-1",
      cashChange: 400,
      taxMode: "differential",
      taxRate: 19,
      taxAmount: 23.95,
      netAmount: 376.05,
      reconciled: true,
    });
    expect(result.ledger[0].note).toContain("§25a intern");
    expect(result.documents[0].metadata).toMatchObject({
      automaticallyBooked: true,
      accountingDate: "2026-04-15",
      accountingAccountCode: "8336",
      paymentAccountCode: "1000",
      differentialPurchasePrice: 250,
      differentialRepairCosts: 20,
      differentialMargin: 150,
      differentialVat: 23.95,
    });
    expect(result.documents[0].metadata?.differentialTaxNote).toContain("§ 25a UStG");
  });

  it("posts a standard card sale to Flatpay clearing without changing cash", () => {
    const state = makeSaleState({
      taxMode: "standard19",
      paymentMethod: "card",
      purchasePrice: 100,
      repairCosts: 0,
      salePrice: 238,
    });

    const result = normalizeSaleAccountingState(state);
    expect(result.ledger[0]).toMatchObject({
      accountCode: "8400",
      counterAccountCode: "1360",
      documentNumber: "RE-2026-0001",
      cashChange: 0,
      taxMode: "standard19",
      taxRate: 19,
      taxAmount: 38,
      netAmount: 200,
    });
    expect(result.documents[0]).toMatchObject({
      paymentMethod: "card",
      taxMode: "standard19",
      taxAmount: 38,
      status: "paid",
    });
  });

  it("is idempotent once sale postings are normalized", () => {
    const state = makeSaleState({
      taxMode: "differential",
      paymentMethod: "bank",
      purchasePrice: 250,
      repairCosts: 20,
      salePrice: 400,
    });
    const first = normalizeSaleAccountingState(state);
    const second = normalizeSaleAccountingState(first);
    expect(second).toBe(first);
  });
});

function makeSaleState(input: {
  taxMode: Device["taxMode"];
  paymentMethod: Sale["paymentMethod"];
  purchasePrice: number;
  repairCosts: number;
  salePrice: number;
}): AppState {
  const device: Device = {
    id: "device-1",
    stockNumber: "GER-2026-0001",
    category: "Smartphone",
    brand: "Apple",
    model: "iPhone 13",
    imei1: "490154203237518",
    condition: "good",
    status: "sold",
    purchaseId: "purchase-1",
    purchasePrice: input.purchasePrice,
    purchaseDate: "2026-03-01",
    taxMode: input.taxMode,
    repairCosts: input.repairCosts,
    saleId: "sale-1",
    salePrice: input.salePrice,
    saleDate: "2026-04-15",
    createdAt: "2026-03-01T12:00:00.000Z",
  };
  const sale: Sale = {
    id: "sale-1",
    saleNumber: "RE-2026-0001",
    deviceId: device.id,
    date: "2026-04-15",
    price: input.salePrice,
    paymentMethod: input.paymentMethod,
    taxMode: input.taxMode,
    documentType: "invoice",
    documentId: "document-1",
    grossMargin: input.salePrice - input.purchasePrice,
    differentialVat: 0,
    profitAfterVatAndRepair: 0,
    createdAt: "2026-04-15T12:00:00.000Z",
  };
  const document: BusinessDocument = {
    id: "document-1",
    documentNumber: "RE-2026-0001",
    type: "invoice",
    date: sale.date,
    deviceId: device.id,
    saleId: sale.id,
    amount: sale.price,
    taxAmount: 0,
    taxMode: sale.taxMode,
    paymentMethod: sale.paymentMethod,
    status: "paid",
    createdAt: sale.createdAt,
  };
  const ledger: LedgerEntry = {
    id: "ledger-1",
    date: sale.date,
    direction: "income",
    amount: sale.price,
    paymentMethod: sale.paymentMethod,
    description: "Verkauf Apple iPhone 13",
    category: "Verkauf",
    source: "sale",
    sourceId: sale.id,
    documentId: document.id,
    taxAmount: 0,
    taxRate: 0,
    taxMode: sale.taxMode,
    reconciled: true,
    createdAt: sale.createdAt,
  };
  return {
    version: 1,
    customers: [],
    devices: [device],
    purchases: [],
    sales: [sale],
    documents: [document],
    ledger: [ledger],
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
