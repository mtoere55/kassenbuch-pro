import { describe, expect, it } from "vitest";
import { detectBankStatementEvidence, isLikelyBankStatementText } from "./document-control";

describe("bank statement document protection", () => {
  it("recognizes a bank statement even when OCR only exposes generic account-statement text", () => {
    const text = `
Sparkasse
Kontoauszug für 01 April 2026 bis 29 Mai 2026
IBAN DE12 3456 7890 1234 5678 90
Buchungstag Wertstellung Verwendungszweck Betrag
Neuer Kontostand 20.426,00 EUR
`;

    const evidence = detectBankStatementEvidence(text);
    expect(evidence.isLikelyBankStatement).toBe(true);
    expect(evidence.signals).toContain("Kontoauszug");
    expect(isLikelyBankStatementText(text)).toBe(true);
  });

  it("does not classify an ordinary supplier invoice as a bank statement just because it contains IBAN and BIC", () => {
    const text = `
Musterteile GmbH
Rechnungsnummer 2026-105
Rechnungsdatum 02.07.2026
Nettobetrag 100,00 EUR
Mehrwertsteuer 19,00 EUR
Gesamtbetrag 119,00 EUR
IBAN DE12 3456 7890 1234 5678 90
BIC TESTDEFFXXX
`;

    expect(isLikelyBankStatementText(text)).toBe(false);
  });
});
