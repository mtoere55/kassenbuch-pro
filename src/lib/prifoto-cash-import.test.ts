import { describe, expect, it } from "vitest";
import { createPrifotoCashImportPlan, parsePrifotoCashReport } from "./prifoto-cash-import";
import type { AppState, LedgerEntry } from "./types";

const MAY = `
Umsatzbericht
Prifoto GmbH Kleppingstr. 28, 44135 Dortmund
Ali Sun Kundennummer: 168
Badstraße 6 Rechnungnummer: RE-010520263193
Rechnungsdatum: 01.06.2026
58095 Hagen
Zeitraum: Mai 2026
Gesamtumsatz Bestellungen Tagesdurchschnitt Bester Tag
573,00 € 33 33,71 € Montag, 04.05. 85,00 €
Datum Wochentag Umsatz Bestellungen
02.05. Samstag 17,00 € 1
04.05. Montag 85,00 € 5
05.05. Dienstag 17,00 € 1
06.05. Mittwoch 17,00 € 1
07.05. Donnerstag 20,00 € 1
08.05. Freitag 17,00 € 1
11.05. Montag 34,00 € 2
12.05. Dienstag 34,00 € 2
13.05. Mittwoch 17,00 € 1
15.05. Freitag 71,00 € 4
18.05. Montag 17,00 € 1
19.05. Dienstag 71,00 € 4
21.05. Donnerstag 17,00 € 1
22.05. Freitag 17,00 € 1
26.05. Dienstag 68,00 € 4
28.05. Donnerstag 20,00 € 1
29.05. Freitag 34,00 € 2
Gesamt 17 Tage mit Umsatz 573,00 € 33
Produktanteile
Fotoshooting EU 462,00 € (80,6%)
4x2 DE 66,00 € (11,5%)
TopPortrait Digital Download 33,00 € (5,8%)
Retusche_de 12,00 € (2,1%)
`;

const JUNE = `
Umsatzbericht
Prifoto GmbH Kleppingstr. 28, 44135 Dortmund
Ali Sun Kundennummer: 168
Badstraße 6 Rechnungnummer: RE-010620263320
Rechnungsdatum: 04.07.2026
58095 Hagen
Zeitraum: Juni 2026
Gesamtumsatz Bestellungen Tagesdurchschnitt Bester Tag
480,00 € 30 32,00 € Montag, 15.06. 77,00 €
Datum Wochentag Umsatz Bestellungen
01.06. Montag 20,00 € 1
02.06. Dienstag 51,00 € 3
03.06. Mittwoch 17,00 € 1
08.06. Montag 71,00 € 5
11.06. Donnerstag 40,00 € 2
12.06. Freitag 17,00 € 1
15.06. Montag 77,00 € 4
16.06. Dienstag 17,00 € 1
17.06. Mittwoch 17,00 € 1
19.06. Freitag 17,00 € 1
23.06. Dienstag 17,00 € 1
24.06. Mittwoch 51,00 € 3
26.06. Freitag 34,00 € 3
27.06. Samstag 17,00 € 1
30.06. Dienstag 17,00 € 2
Gesamt 15 Tage mit Umsatz 480,00 € 30
Produktanteile
Fotoshooting EU 420,00 € (78,7%)
4x2 DE 60,00 € (11,2%)
TopPortrait Digital Download 30,00 € (5,6%)
Retusche_de 24,00 € (4,5%)
`;

describe("Prifoto cash PDF import", () => {
  it("parses and validates the May daily report", () => {
    const report = parsePrifotoCashReport(MAY);
    expect(report).toMatchObject({
      invoiceNumber: "RE-010520263193",
      invoiceDate: "2026-06-01",
      periodMonth: "2026-05",
      total: 573,
      orderCount: 33,
      salesDayCount: 17,
      productTotal: 573,
      productDifference: 0,
    });
    expect(report.days).toHaveLength(17);
    expect(report.days.reduce((sum, day) => sum + day.amount, 0)).toBe(573);
  });

  it("accepts June daily totals and reports the non-booking product-chart discrepancy", () => {
    const report = parsePrifotoCashReport(JUNE);
    expect(report).toMatchObject({
      invoiceNumber: "RE-010620263320",
      total: 480,
      orderCount: 30,
      salesDayCount: 15,
      productTotal: 534,
      productDifference: 54,
    });
  });

  it("books every May day fully to cash and splits each amount 50/50", () => {
    const report = parsePrifotoCashReport(MAY);
    const plan = createPrifotoCashImportPlan(emptyState(), report, "may.pdf");
    expect(plan).toMatchObject({
      importedDays: 17,
      skippedExistingDays: 0,
      totalCash: 573,
      partnerShare: 286.5,
      ownShare: 286.5,
      ownVat: 45.74,
    });
    expect(plan.entries).toHaveLength(34);
    expect(plan.entries.reduce((sum, entry) => sum + (entry.cashChange || 0), 0)).toBe(573);
    expect(plan.entries.filter((entry) => entry.accountCode === "1592").reduce((sum, entry) => sum + entry.amount, 0)).toBe(286.5);
    expect(plan.entries.filter((entry) => entry.accountCode === "8401").reduce((sum, entry) => sum + entry.amount, 0)).toBe(286.5);
    expect(plan.entries.filter((entry) => entry.accountCode === "8401").reduce((sum, entry) => sum + entry.taxAmount, 0)).toBe(45.74);
    expect(plan.entries.every((entry) => entry.paymentMethod === "cash" && entry.counterAccountCode === "1000")).toBe(true);
  });

  it("skips an exact historical Prifoto day and blocks a differing existing cash total", () => {
    const report = parsePrifotoCashReport(MAY);
    const exactState = emptyState();
    exactState.ledger.push(...existingPrifotoDay("2026-05-02", 17));
    const exactPlan = createPrifotoCashImportPlan(exactState, report, "may.pdf");
    expect(exactPlan.skippedExistingDays).toBe(1);
    expect(exactPlan.importedDays).toBe(16);
    expect(exactPlan.conflicts).toEqual([]);

    const conflictState = emptyState();
    conflictState.ledger.push(...existingPrifotoDay("2026-05-02", 15));
    const conflictPlan = createPrifotoCashImportPlan(conflictState, report, "may.pdf");
    expect(conflictPlan.conflicts).toEqual([
      { date: "2026-05-02", reportTotal: 17, existingTotal: 15, difference: 2 },
    ]);
  });
});

function existingPrifotoDay(date: string, total: number): LedgerEntry[] {
  const first = Math.round(total * 50) / 100;
  const second = Math.round((total - first) * 100) / 100;
  return [
    baseEntry("partner", date, first, "1592", "Prifoto Fremdanteil"),
    baseEntry("own", date, second, "8401", "Prifoto Eigenanteil"),
  ];
}

function baseEntry(id: string, date: string, amount: number, accountCode: string, description: string): LedgerEntry {
  return {
    id,
    date,
    direction: accountCode === "1592" ? "transfer" : "income",
    amount,
    paymentMethod: "cash",
    description,
    category: `${accountCode} · Prifoto`,
    source: "kasImport",
    sourceId: `kas:test:${id}`,
    taxAmount: accountCode === "8401" ? 1 : 0,
    taxRate: accountCode === "8401" ? 19 : 0,
    taxMode: accountCode === "8401" ? "standard19" : "taxFree",
    reconciled: true,
    accountCode,
    counterAccountCode: "1000",
    cashChange: amount,
    netAmount: amount,
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
