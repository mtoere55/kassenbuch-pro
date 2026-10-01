import { describe, expect, it } from "vitest";
import { parsePayPalMonthlyStatement, importPayPalMonthlyStatement } from "./paypal-pdf-import";
import type { AppState, LedgerEntry } from "./types";

const JULY = "Händlerkonto-ID: GQ7MXTPGWHGKU PayPal-ID: suntel58135@gmail.com 01.07.26 - 31.07.26\n\nKontoauszug für Juli 2026\nSun Tel\nGuthaben – Zusammenfassung (01.07.26 - 31.07.26)\n\nKontoaktivitäten – Zusammenfassung (01.07.26 - 31.07.26)\nVerfügbares Guthaben (alt) 0,00\nErhaltene Zahlungen 0,00\nGesendete Zahlungen -246,54\nAbbuchungen und Belastungen 0,00\nEinzahlungen und Gutschriften 246,54\nGebühren 0,00\nVerfügbares Guthaben (neu) 0,00\n\nTransaktionsübersicht - EUR\nDatum Typ Name E-Mail-Adresse Transaktionscode Brutto Entgelt Netto\nPayPal Express-\n10.07.26 eBay S.a.r.l. ayments@ebay.co 88F56230SP6280155 -23,90 0,00 -23,90\nZahlung\nm\nBankgutschrift\n10.07.26 9GR917004C655772V 23,90 0,00 23,90\nauf PayPal-Konto\nPayPal Express-\n10.07.26 otara GmbH info@otara.de 7ES25171JH522440D -107,87 0,00 -107,87\nZahlung\nBankgutschrift\n10.07.26 7N692841AE043135L 107,87 0,00 107,87\nauf PayPal-Konto\nPayPal Express-\n10.07.26 eBay S.a.r.l. ayments@ebay.co 0GW013808V491340Y -27,90 0,00 -27,90\nZahlung\nm\nBankgutschrift\n10.07.26 2KL32248V91394431 27,90 0,00 27,90\nauf PayPal-Konto\nPayPal Express-\n10.07.26 eBay S.a.r.l. ayments@ebay.co 9XH851837A803333F -11,99 0,00 -11,99\nZahlung\nm\nBankgutschrift\n10.07.26 3VF71499DX085473D 11,99 0,00 11,99\nauf PayPal-Konto\nPayPal Express-\n13.07.26 eBay S.a.r.l. ayments@ebay.co 0F435194637021324 -5,99 0,00 -5,99\nZahlung\nm\nBankgutschrift\n13.07.26 1EH91981JK2255711 5,99 0,00 5,99\nauf PayPal-Konto\nPayPal Express-\n13.07.26 eBay S.a.r.l. ayments@ebay.co 0RT62743MP724931F -39,90 0,00 -39,90\nZahlung\nm\nBankgutschrift\n13.07.26 9NJ9432074836580T 39,90 0,00 39,90\nauf PayPal-Konto\nPayPal Express-\n13.07.26 eBay S.a.r.l. ayments@ebay.co 60S25500BX182911F -28,99 0,00 -28,99\nZahlung\nm\nBankgutschrift\n13.07.26 7RC8249384708630H 28,99 0,00 28,99\nauf PayPal-Konto\n\nHinweis: Dieser Kontoauszug ist keine Rechnung im Sinne des UStG.";


const SEPTEMBER = `Händlerkonto-ID: GQ7MXTPGWHGKU PayPal-ID: suntel58135@gmail.com 01.09.26 - 30.09.26
Kontoauszug für September 2026
Kontoaktivitäten – Zusammenfassung (01.09.26 - 30.09.26)
Verfügbares Guthaben (alt) 0,00
Erhaltene Zahlungen 0,00
Gesendete Zahlungen -454,63
Abbuchungen und Belastungen 0,00
Einzahlungen und Gutschriften 454,63
Gebühren 0,00
Verfügbares Guthaben (neu) 0,00
Transaktionsübersicht - EUR
Datum Typ Name E-Mail-Adresse Transaktionscode Brutto Entgelt Netto
PayPal Express-
01.09.26 eBay S.a.r.l. 4N758392D5207644C -6,59 0,00 -6,59
Zahlung
Bankgutschrift
01.09.26 4TY34292979261647 6,59 0,00 6,59
auf PayPal-Konto
PayPal Express-
01.09.26 MAS Trade GmbH 0GG4317819167862M -87,08 0,00 -87,08
Zahlung
Bankgutschrift
01.09.26 48V88664DY9979934 87,08 0,00 87,08
auf PayPal-Konto
PayPal Express-
01.09.26 MediaMarktSaturn Plattform Services GmbH 0P252066836840908 -137,35 0,00 -137,35
Zahlung
Bankgutschrift
01.09.26 6VH765892X713911A 137,35 0,00 137,35
auf PayPal-Konto
PayPal Express-
03.09.26 eBay S.a.r.l. 2BM24487J61503846 -21,56 0,00 -21,56
Zahlung
Bankgutschrift
03.09.26 85406377LM507760A 21,56 0,00 21,56
auf PayPal-Konto
PayPal Express-
04.09.26 eBay S.a.r.l. 009630773S050053X -50,25 0,00 -50,25
Zahlung
Bankgutschrift
04.09.26 7CH54910PN5743419 50,25 0,00 50,25
auf PayPal-Konto
PayPal Express-
07.09.26 Corendon Touristik GMBH 0YH74316V2056062W -115,97 0,00 -115,97
Zahlung
Bankgutschrift
07.09.26 53R37307614829133 115,97 0,00 115,97
auf PayPal-Konto
PayPal Express-
19.09.26 AliExpress 7CR050502P6018352 -22,44 0,00 -22,44
Zahlung
Bankgutschrift
19.09.26 28N73050V5930084F 22,44 0,00 22,44
auf PayPal-Konto
PayPal Express-
24.09.26 eBay S.a.r.l. 41P855030J395342J -7,90 0,00 -7,90
Zahlung
Bankgutschrift
24.09.26 57762713R3607380N 7,90 0,00 7,90
auf PayPal-Konto
Hinweis: Dieser Kontoauszug ist keine Rechnung im Sinne des UStG.
Copyright © 1999-2026 PayPal.
Boulevard Royal, L-2449 Luxemburg.
Seite 4 von 5
Transaktionsübersicht - EUR
Datum Typ Name E-Mail-Adresse Transaktionscode Brutto Entgelt Netto
PayPal Express-
28.09.26 eBay S.a.r.l. 28B43711PD668501K -5,49 0,00 -5,49
Zahlung
Bankgutschrift
28.09.26 546282103X139594C 5,49 0,00 5,49
auf PayPal-Konto
Hinweis: Dieser Kontoauszug ist keine Rechnung im Sinne des UStG.`;

describe("PayPal monthly PDF import", () => {

  it("continues across PayPal PDF page footers and includes the final 5.49 euro September transaction", () => {
    const report = parsePayPalMonthlyStatement(SEPTEMBER);
    expect(report).toMatchObject({
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      sentPayments: -454.63,
      credits: 454.63,
      closingBalance: 0,
    });
    expect(report.transactions).toHaveLength(18);
    expect(report.transactions.filter((item) => item.transactionType === "payment")).toHaveLength(9);
    expect(report.transactions.filter((item) => item.transactionType === "bankFunding")).toHaveLength(9);
    expect(report.transactions.find((item) => item.externalId === "28B43711PD668501K")).toMatchObject({
      date: "2026-09-28",
      amount: -5.49,
      transactionType: "payment",
    });
    expect(report.transactions.find((item) => item.externalId === "546282103X139594C")).toMatchObject({
      date: "2026-09-28",
      amount: 5.49,
      transactionType: "bankFunding",
    });
  });

  it("parses and validates the uploaded July 2026 statement", () => {
    const report = parsePayPalMonthlyStatement(JULY);
    expect(report).toMatchObject({
      merchantId: "GQ7MXTPGWHGKU",
      paypalId: "suntel58135@gmail.com",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      openingBalance: 0,
      closingBalance: 0,
      sentPayments: -246.54,
      credits: 246.54,
      fees: 0,
    });
    expect(report.transactions).toHaveLength(14);
    expect(report.transactions.filter((item) => item.transactionType === "payment")).toHaveLength(7);
    expect(report.transactions.filter((item) => item.transactionType === "bankFunding")).toHaveLength(7);
    expect(report.transactions.find((item) => item.externalId === "7ES25171JH522440D")).toMatchObject({
      date: "2026-07-10",
      amount: -107.87,
      counterparty: "otara GmbH",
      transactionType: "payment",
    });
  });

  it("posts supplier payments on PayPal and links matching Bank to PayPal funding instead of duplicating it", () => {
    const state = emptyState();
    state.ledger.push(bankFunding("bank-23", "2026-07-10", 23.9));
    const report = parsePayPalMonthlyStatement(JULY);
    const imported = importPayPalMonthlyStatement(state, report, "paypal-july.pdf");

    expect(imported.importedTransactions).toBe(14);
    expect(imported.state.importedTransactions).toHaveLength(14);
    const funding = imported.state.importedTransactions.find((item) => item.externalId === "9GR917004C655772V");
    expect(funding).toMatchObject({
      matchedLedgerEntryId: "bank-23",
      bookkeepingStatus: "reviewed",
      status: "ignored",
    });
    expect(imported.state.ledger.filter((entry) => entry.id === "bank-23")).toHaveLength(1);
    expect(imported.state.ledger.filter((entry) => entry.sourceId === "paypal:9GR917004C655772V")).toHaveLength(0);

    const otara = imported.state.ledger.find((entry) => entry.sourceId === "paypal:7ES25171JH522440D");
    expect(otara).toMatchObject({
      direction: "expense",
      amount: 107.87,
      paymentMethod: "paypal",
      accountCode: "3400",
      counterAccountCode: "1370",
      taxRate: 0,
    });
    expect(imported.state.documents[0].metadata?.paypalStatementFingerprint).toBe(report.fingerprint);
  });

  it("rejects the same monthly statement twice", () => {
    const report = parsePayPalMonthlyStatement(JULY);
    const first = importPayPalMonthlyStatement(emptyState(), report, "paypal-july.pdf");
    expect(() => importPayPalMonthlyStatement(first.state, report, "paypal-july.pdf")).toThrow(/bereits/);
  });
});

function bankFunding(id: string, date: string, amount: number): LedgerEntry {
  return {
    id,
    date,
    direction: "transfer",
    amount,
    paymentMethod: "bank",
    description: "Bank an PayPal",
    category: "1370 · PayPal",
    source: "bankImport",
    sourceId: `bank:${id}`,
    taxAmount: 0,
    taxRate: 0,
    taxMode: "taxFree",
    reconciled: true,
    accountCode: "1370",
    counterAccountCode: "1200",
    cashChange: 0,
    netAmount: amount,
    manualKind: "transfer",
    createdAt: `${date}T12:00:00.000Z`,
  };
}

function emptyState(): AppState {
  return {
    version: 1,
    customers: [],
    devices: [],
    purchases: [],
    sales: [],
    repairs: [],
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
