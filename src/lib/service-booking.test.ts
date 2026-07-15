import { describe, expect, it } from "vitest";
import { createServiceBooking } from "./service-booking";
import type { AppState } from "./types";

describe("Unitel and Prifoto service bookings", () => {
  it("splits a cash Unitel top-up into clearing and commission without double counting cash", () => {
    const result = createServiceBooking(makeState(), {
      kind: "unitelTopup",
      date: "2026-04-20",
      amount: 100,
      commissionAmount: 4,
      paymentMethod: "cash",
      createReceipt: true,
    });

    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toMatchObject({
      direction: "transfer",
      amount: 96,
      accountCode: "1590",
      counterAccountCode: "1000",
      cashChange: 96,
      taxRate: 0,
    });
    expect(result.entries[1]).toMatchObject({
      direction: "income",
      amount: 4,
      accountCode: "8403",
      counterAccountCode: "1000",
      cashChange: 4,
      taxRate: 19,
      taxAmount: 0.64,
    });
    expect(result.entries.reduce((sum, entry) => sum + (entry.cashChange || 0), 0)).toBe(100);
    expect(result.document).toMatchObject({
      documentNumber: "QU-2026-0001",
      amount: 100,
      paymentMethod: "cash",
      status: "paid",
    });
    expect(result.document?.metadata).toMatchObject({
      nominalAmount: 100,
      commissionAmount: 4,
      bookingNumber: "KASSE-202604-0001",
    });
  });

  it("books a Unitel contractual commission directly to commission income", () => {
    const result = createServiceBooking(makeState(), {
      kind: "unitelCommission",
      date: "2026-04-21",
      amount: 119,
      paymentMethod: "bank",
      createReceipt: false,
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      direction: "income",
      accountCode: "8403",
      counterAccountCode: "1200",
      cashChange: 0,
      taxRate: 19,
      taxAmount: 19,
      netAmount: 100,
      documentNumber: "KASSE-202604-0001",
    });
  });

  it("splits a Prifoto card payment 50/50 between clearing and own commission", () => {
    const result = createServiceBooking(makeState(), {
      kind: "prifotoSale",
      date: "2026-04-22",
      amount: 100,
      ownShareAmount: 50,
      paymentMethod: "card",
      createReceipt: false,
    });

    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toMatchObject({
      direction: "transfer",
      amount: 50,
      accountCode: "1592",
      counterAccountCode: "1360",
      cashChange: 0,
      taxRate: 0,
    });
    expect(result.entries[1]).toMatchObject({
      direction: "income",
      amount: 50,
      accountCode: "8401",
      counterAccountCode: "1360",
      cashChange: 0,
      taxRate: 19,
      taxAmount: 7.98,
      netAmount: 42.02,
    });
  });

  it("rejects shares that exceed the customer payment", () => {
    expect(() => createServiceBooking(makeState(), {
      kind: "prifotoSale",
      date: "2026-04-22",
      amount: 100,
      ownShareAmount: 120,
      paymentMethod: "cash",
      createReceipt: false,
    })).toThrow(/zwischen 0 und dem Gesamtbetrag/);
  });
});

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
