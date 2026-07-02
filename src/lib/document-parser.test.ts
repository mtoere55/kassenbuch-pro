import { describe, expect, it } from "vitest";
import { detectDocumentType, parseSupplierInvoice, parseZReport } from "./document-parser";

const zReportText = `
Tagesabschluss
Geöffnet von: SunTel
Geschlossen: 01.07.2026 19:13:41
Z-Bericht-Nummer: 245
VERKAUFSÜBERSICHT
Gesamtumsatz vor Abzug 230,00 €
Gesamtsumme der Mehrwertsteuer 36,72 €
Umsatz (exkl. MwSt.) 193,28 €
Bar: Verkäufe 70,00 €
Karte: Verkäufe 160,00 €
Startbetrag 100,00 €
Erwartetes Bargeld 170,00 €
Gezählter Bargeldbestand 70,00 €
Differenz -100,00 €
Anzahl Verkäufe 9
`;

describe("document parser", () => {
  it("detects and parses a German Z report", () => {
    expect(detectDocumentType(zReportText)).toBe("zReport");
    expect(parseZReport(zReportText)).toMatchObject({
      date: "2026-07-01",
      zNumber: "245",
      gross: 230,
      net: 193.28,
      vat: 36.72,
      cash: 70,
      card: 160,
      openingCash: 100,
      expectedCash: 170,
      countedCash: 70,
      difference: -100,
      salesCount: 9,
    });
  });

  it("parses a supplier invoice", () => {
    const invoice = parseSupplierInvoice(`
Musterteile GmbH
Rechnungsnummer: 2026-105
Rechnungsdatum: 02.07.2026
Nettobetrag 100,00 EUR
Mehrwertsteuer 19,00 EUR
Gesamtbetrag 119,00 EUR
`);
    expect(invoice).toMatchObject({
      invoiceNumber: "2026-105",
      date: "2026-07-02",
      gross: 119,
      net: 100,
      vat: 19,
    });
  });
});
