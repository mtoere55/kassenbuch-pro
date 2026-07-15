import { describe, expect, it } from "vitest";
import { isMalformedLegacyPdfImport } from "./import-repair";
import type { ImportedTransaction } from "./types";

function transaction(patch: Partial<ImportedTransaction> = {}): ImportedTransaction {
  return {
    id: "import-1",
    accountType: "paypal",
    date: "2026-07-15",
    amount: 41_450_500_010_106_020_000,
    description: "Importierter Umsatz",
    transactionType: "other",
    matchConfidence: 0,
    status: "new",
    createdAt: "2026-07-15T11:00:00.000Z",
    ...patch,
  };
}

describe("malformed legacy PDF import repair", () => {
  it("detects the old IBAN-as-amount rows", () => {
    expect(isMalformedLegacyPdfImport(transaction())).toBe(true);
  });

  it("does not remove normal or already booked transactions", () => {
    expect(isMalformedLegacyPdfImport(transaction({ amount: 281.95 }))).toBe(false);
    expect(isMalformedLegacyPdfImport(transaction({ matchedLedgerEntryId: "ledger-1" }))).toBe(false);
    expect(isMalformedLegacyPdfImport(transaction({ accountType: "bank" }))).toBe(false);
  });
});
