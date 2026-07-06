import { describe, expect, it } from "vitest";
import { parseTransactionsCsv, summarizeImportedTransactions } from "./csv";

const paypalCsv = `"Datum","Uhrzeit","Zeitzone","Beschreibung","Währung","Brutto","Entgelt","Netto","Guthaben","Transaktionscode","Absender E-Mail-Adresse","Name","Name der Bank","Bankkonto","Versand- und Bearbeitungsgebühr","Umsatzsteuer","Rechnungsnummer","Zugehöriger Transaktionscode"
"27.06.2026","11:54:55","Europe/Berlin","PayPal Express-Zahlung","EUR","-64,18","0,00","-64,18","-64,18","5UH49547H6232962H","eu_eur_managed_payments@ebay.com","eBay S.a.r.l.","","","0,00","0,00","v2_test_2_6","95859768YC8713603"
"27.06.2026","11:54:55","Europe/Berlin","Bankgutschrift auf PayPal-Konto","EUR","64,18","0,00","64,18","0,00","5GC50894GM949750D","","","","","0,00","0,00","v2_test_2_6","5UH49547H6232962H"
"27.05.2026","13:02:44","Europe/Berlin","Rückzahlung","EUR","5,45","0,00","5,45","5,45","3XC13788P4745282W","eu_eur_managed_payments@ebay.com","eBay S.a.r.l.","","","0,00","0,00","refund-1","2NK974069T354035P"`;

describe("PayPal CSV import", () => {
  it("reads the detailed German PayPal activity report", () => {
    const transactions = parseTransactionsCsv(paypalCsv, "paypal");
    expect(transactions).toHaveLength(3);
    expect(transactions[0]).toMatchObject({
      date: "2026-06-27",
      time: "11:54:55",
      amount: -64.18,
      transactionType: "payment",
      counterparty: "eBay S.a.r.l.",
      invoiceNumber: "v2_test_2_6",
      externalId: "5UH49547H6232962H",
      relatedExternalId: "95859768YC8713603",
      status: "new",
    });
  });

  it("marks bank funding as an internal transfer instead of income", () => {
    const transactions = parseTransactionsCsv(paypalCsv, "paypal");
    expect(transactions[1]).toMatchObject({
      amount: 64.18,
      transactionType: "bankFunding",
      description: "Umbuchung Bank → PayPal",
      status: "ignored",
    });
  });

  it("keeps refunds for review and summarizes the report", () => {
    const transactions = parseTransactionsCsv(paypalCsv, "paypal");
    expect(transactions[2].transactionType).toBe("refund");
    expect(summarizeImportedTransactions(transactions)).toEqual({
      total: 3,
      paypalPayments: 1,
      paypalRefunds: 1,
      internalTransfers: 1,
      fees: 0,
    });
  });
});
