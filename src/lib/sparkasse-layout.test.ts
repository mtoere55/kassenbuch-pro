import { describe, expect, it } from "vitest";
import {
  isSupportedSparkasseStatementText,
  normalizeSparkasseLayoutText,
  parseSparkasseLayoutStatement,
} from "./sparkasse-layout";

const positionedStatement = `S Sparkasse an Volme und Ruhr
Kontoauszug 4/2026 Seite 1 von 1
K onto-Nr. 106018000, DE41 4505 0001 0106 0180 00
Kontostand am 31.03.2026, Auszug Nr. 3 1.000,00
01.04.2026GutschriftÜberweisung 100,00
SHIFT4 LIMITED Flatpay
02.04.2026Lastschrift -50,00
Beispiel Lieferant GmbH
Kontostand am 30.04.2026 um 20:05 Uhr 1.050,00`;

const valueDateStatement = `S Sparkasse an Volme und Ruhr
Kontoauszug 5/2026 Seite 1 von 1
Konto-Nr. 106018000, DE41 4505 0001 0106 0180 00
Kontostand am 30.04.2026, Auszug Nr. 4 1.000,00
15.05.2026 GutschriftÜberweisung / Wert: 14.05.2026 76,23
Shift4 Limited Flatpay
26.05.2026 GutschriftÜberweisung / Wert: 25.05.2026 54,46
Shift4 Limited Flatpay
26.05.2026 Lastschrift / Wert: 25.05.2026 -27,99
PayPal Europe S.a.r.l. et Cie S.C.A
Kontostand am 29.05.2026 um 20:05 Uhr 1.102,70`;

describe("Sparkasse positioned PDF import", () => {
  it("recognizes and normalizes rows where date and booking type touch", () => {
    expect(isSupportedSparkasseStatementText(positionedStatement)).toBe(true);
    const normalized = normalizeSparkasseLayoutText(positionedStatement);
    expect(normalized).toContain("Konto-Nr. 106018000");
    expect(normalized).toContain("01.04.2026 GutschriftÜberweisung 100,00");
  });

  it("parses real positioned-row shape without falling back to CSV", () => {
    const report = parseSparkasseLayoutStatement(positionedStatement);
    expect(report).toMatchObject({
      statementNumber: "4/2026",
      periodStart: "2026-04-01",
      periodEnd: "2026-04-30",
      openingBalance: 1000,
      closingBalance: 1050,
    });
    expect(report?.transactions.map((transaction) => ({
      date: transaction.date,
      amount: transaction.amount,
    }))).toEqual([
      { date: "2026-04-01", amount: 100 },
      { date: "2026-04-02", amount: -50 },
    ]);
  });

  it("includes Gutschrift and Lastschrift rows that carry a separate value date", () => {
    const report = parseSparkasseLayoutStatement(valueDateStatement);
    expect(report).toMatchObject({
      statementNumber: "5/2026",
      openingBalance: 1000,
      closingBalance: 1102.7,
    });
    expect(report?.transactions.map((transaction) => ({
      bookingType: transaction.bookingType,
      amount: transaction.amount,
    }))).toEqual([
      { bookingType: "GutschriftÜberweisung", amount: 76.23 },
      { bookingType: "GutschriftÜberweisung", amount: 54.46 },
      { bookingType: "Lastschrift", amount: -27.99 },
    ]);
  });

  it("does not identify unrelated text as a supported statement", () => {
    expect(parseSparkasseLayoutStatement("Datum,Betrag,Beschreibung\n01.04.2026,10,Test")).toBeUndefined();
  });
});
