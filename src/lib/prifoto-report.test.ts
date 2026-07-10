import { describe, expect, it } from "vitest";
import { initialState } from "./store";
import { createPrifotoImportPlan, parsePrifotoDetailReport, parsePrifotoSalesReport } from "./prifoto-report";

const sample = `Umsatzbericht
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
Retusche_de 24,00 € (4,5%)`;

const detail = `Abrechnungsübersicht
Prifoto GmbH Kleppingstr. 28, 44135 Dortmund
Ali Sun Kundennummer: 168
Badstraße 6 Rechnungnummer: RE-010620263320
Rechnungsdatum: 04.07.2026
58095 Hagen
Zeitraum: Juni 2026
Fotografie
Brutto Einnahmen Fotografie 480,00 €
Anteil Prifoto 240,00 €
Gesamtbetrag Brutto 240,00 €`;

describe("Prifoto sales report", () => {
  it("parses the monthly report and daily rows", () => {
    const report = parsePrifotoSalesReport(sample);
    expect(report).toMatchObject({
      invoiceNumber: "RE-010620263320",
      invoiceDate: "2026-07-04",
      customerNumber: "168",
      periodLabel: "Juni 2026",
      startDate: "2026-06-01",
      endDate: "2026-06-30",
      totalSales: 480,
      orderCount: 30,
      dailyAverage: 32,
      bestDayAmount: 77,
    });
    expect(report.days).toHaveLength(15);
    expect(report.days.reduce((sum, day) => sum + day.amount, 0)).toBe(480);
    expect(report.days.reduce((sum, day) => sum + day.orders, 0)).toBe(30);
  });

  it("parses the detail statement with Prifoto share", () => {
    const parsed = parsePrifotoDetailReport(detail);
    expect(parsed).toMatchObject({
      invoiceNumber: "RE-010620263320",
      invoiceDate: "2026-07-04",
      totalSales: 480,
      prifotoShareGross: 240,
      ownShareGross: 240,
    });
  });

  it("books customer payments through clearing and only the own share as revenue", () => {
    const report = parsePrifotoSalesReport(sample);
    const plan = createPrifotoImportPlan(
      initialState,
      report,
      Object.fromEntries(report.days.map((day) => [day.date, day.amount])),
      240,
      "RE-010620263320_Tagesverkäufe.pdf",
    );
    expect(plan.entries).toHaveLength(16);
    expect(plan.cashEntries).toBe(15);
    expect(plan.cardEntries).toBe(0);
    expect(plan.clearingEntries).toBe(15);
    expect(plan.revenueEntries).toBe(1);
    expect(plan.prifotoShareGross).toBe(240);
    expect(plan.ownShareGross).toBe(240);
    expect(plan.document.metadata?.provider).toBe("Prifoto");
    expect(plan.document.metadata?.prifotoShareGross).toBe(240);
    expect(plan.entries[0]).toMatchObject({
      source: "prifotoImport",
      direction: "transfer",
      accountCode: "1000",
      counterAccountCode: "1592",
      taxRate: 0,
    });
    const revenue = plan.entries.at(-1);
    expect(revenue).toMatchObject({
      source: "prifotoImport",
      direction: "income",
      accountCode: "8400",
      counterAccountCode: "1592",
      amount: 240,
      taxRate: 19,
      cashChange: 0,
    });
    expect(revenue?.taxAmount).toBe(38.32);
    expect(() => createPrifotoImportPlan(
      { ...initialState, documents: [plan.document, ...initialState.documents] },
      report,
      Object.fromEntries(report.days.map((day) => [day.date, day.amount])),
      240,
      "RE-010620263320_Tagesverkäufe.pdf",
    )).toThrow(/bereits/);
  });
});
