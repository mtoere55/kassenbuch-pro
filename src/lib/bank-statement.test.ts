import { describe, expect, it } from "vitest";
import {
  importBankStatement,
  parseSparkasseStatement,
  reviewBankTransaction,
} from "./bank-statement";
import type { AppState } from "./types";

const statementText = `S Sparkasse an Volme und Ruhr
Kontoauszug 4/2026 Seite 1 von 7
Konto-Nr. 106018000, DE41 4505 0001 0106 0180 00
Kontostand am 31.03.2026, Auszug Nr. 3 2.372,11
01.04.2026 Lastschrift -114,78
Tchibo Coffee Service GmbH /INV/KS-DARL.01 1.4.2026
01.04.2026 Dauerauftrag -1.275,22
Dr.K.Junker Miete u.Betriebskosten
01.04.2026 GutschriftÜberweisung 281,95
SHIFT4 LIMITED 69272240100 Flatpay
02.04.2026 Lastschrift -191,07
PayPal Europe S.a.r.l. et Cie S.C.A Einkauf bei otara GmbH 1049294169928
02.04.2026 Bargeldeinzahlung SB 100,00
SB-EINZAHLUNG HGS HA KH
07.04.2026 Überweisung Echtzeit -759,22
MURAT TOERE Gehalt
30.04.2026 Abrechnung 30.04.2026 / Wert: 01.05.2026 -42,30
siehe Anlage Nr. 1
Kontostand am 30.04.2026 um 20:05 Uhr 371,47
Rechnungsabschluss:
Rechnungsnummer: 20260430-WL081-00029606639`;

describe("Sparkasse bank statement PDF", () => {
  it("parses transactions and validates opening to closing balance", () => {
    const report = parseSparkasseStatement(statementText);
    expect(report).toMatchObject({
      statementNumber: "4/2026",
      accountNumber: "106018000",
      iban: "DE41450500010106018000",
      periodStart: "2026-04-01",
      periodEnd: "2026-04-30",
      openingBalance: 2372.11,
      closingBalance: 371.47,
    });
    expect(report.transactions).toHaveLength(7);
    expect(report.transactions.map((item) => item.classification)).toEqual([
      "expense",
      "rent",
      "cardPayout",
      "paypalFunding",
      "cashDeposit",
      "salary",
      "bankFee",
    ]);
  });

  it("posts internal transfers without treating them as revenue or expense", () => {
    const report = parseSparkasseStatement(statementText);
    const result = importBankStatement(makeState(), report, "Kontoauszug.pdf");

    expect(result.imported).toBe(7);
    expect(result.createdEntries).toBe(7);
    expect(result.internalTransfers).toBe(3);
    expect(result.reviewCount).toBe(1);

    const flatpay = result.state.ledger.find((entry) => entry.description.includes("Flatpay-Auszahlung"));
    expect(flatpay).toMatchObject({
      direction: "transfer",
      accountCode: "1200",
      counterAccountCode: "1360",
      amount: 281.95,
      cashChange: 0,
    });

    const deposit = result.state.ledger.find((entry) => entry.description === "Umbuchung Kasse an Bank");
    expect(deposit).toMatchObject({
      direction: "transfer",
      accountCode: "1200",
      counterAccountCode: "1000",
      cashChange: -100,
    });

    const paypal = result.state.ledger.find((entry) => entry.description.includes("Bank an PayPal"));
    expect(paypal).toMatchObject({
      direction: "transfer",
      accountCode: "1370",
      counterAccountCode: "1200",
      amount: 191.07,
    });
  });

  it("books invoice-dependent expenses immediately with zero VAT until review", () => {
    const report = parseSparkasseStatement(statementText);
    const result = importBankStatement(makeState(), report, "Kontoauszug.pdf");
    const tchiboTransaction = result.state.importedTransactions.find((item) => item.counterparty?.includes("Tchibo"))!;
    const entry = result.state.ledger.find((item) => item.id === tchiboTransaction.matchedLedgerEntryId)!;
    expect(entry).toMatchObject({
      direction: "expense",
      accountCode: "4980",
      taxRate: 0,
      taxAmount: 0,
      paymentMethod: "bank",
    });
    expect(tchiboTransaction.bookkeepingStatus).toBe("booked");

    const reviewed = reviewBankTransaction(result.state, tchiboTransaction.id, {
      description: "Kaffee und Betriebsbedarf",
      accountCode: "4980",
      taxRate: 19,
      direction: "expense",
      paymentMethod: "bank",
    });
    const corrected = reviewed.ledger.find((item) => item.id === entry.id)!;
    expect(corrected.taxAmount).toBe(18.33);
    expect(corrected.netAmount).toBe(96.45);
    expect(reviewed.importedTransactions.find((item) => item.id === tchiboTransaction.id)?.bookkeepingStatus).toBe("reviewed");
  });

  it("blocks the same statement from being imported twice", () => {
    const report = parseSparkasseStatement(statementText);
    const first = importBankStatement(makeState(), report, "Kontoauszug.pdf");
    expect(() => importBankStatement(first.state, report, "Kontoauszug.pdf")).toThrow(/bereits/);
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
