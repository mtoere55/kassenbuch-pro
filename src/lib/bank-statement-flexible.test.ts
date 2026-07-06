import { describe, expect, it } from "vitest";
import { parseSparkasseStatement } from "./bank-statement-flexible";

const mayStatement = `S Sparkasse an Volme und Ruhr
Kontoauszug 5/2026 Seite 1 von 2
Konto-Nr. 106018000, DE41 4505 0001 0106 0180 00
Kontostand am 30.04.2026, Auszug Nr. 4 1.000,00
02.05.2026 Kartenzahlung girocard -100,00
Muster Händler Terminal 1234
05.05.2026 Gutschrift Echtzeit 200,00
Muster Kunde Zahlung Rechnung 55
Kontostand am 31.05.2026 um 20:05 Uhr 1.100,00`;

describe("flexible Sparkasse statement parser", () => {
  it("accepts booking labels that were not hard-coded in the April parser", () => {
    const report = parseSparkasseStatement(mayStatement);
    expect(report).toMatchObject({
      statementNumber: "5/2026",
      periodStart: "2026-05-01",
      periodEnd: "2026-05-31",
      openingBalance: 1000,
      closingBalance: 1100,
    });
    expect(report.transactions).toHaveLength(2);
    expect(report.transactions.map((item) => item.bookingType)).toEqual([
      "Kartenzahlung girocard",
      "Gutschrift Echtzeit",
    ]);
    expect(report.transactions.map((item) => item.amount)).toEqual([-100, 200]);
  });

  it("still blocks import when the full statement does not reconcile", () => {
    expect(() =>
      parseSparkasseStatement(mayStatement.replace("1.100,00", "1.120,00")),
    ).toThrow(/Differenz 20,00/);
  });
});
