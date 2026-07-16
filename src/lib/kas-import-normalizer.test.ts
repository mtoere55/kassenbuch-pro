import { describe, expect, it } from "vitest";
import { normalizeMeinbuchImportEntries } from "./kas-import-normalizer";
import type { LedgerEntry } from "./types";

describe("MeinBuch KAS normalization", () => {
  it("preserves original values and uses the original record id as reference", () => {
    const [entry] = normalizeMeinbuchImportEntries([makeEntry({
      sourceId: "kas:abcd1234:1218",
      date: "2026-06-23",
      description: "netto",
      amount: 53.79,
      cashChange: -53.79,
      accountCode: "0000",
      category: "0000 · Nicht zugeordnet",
    })]);
    expect(entry).toMatchObject({
      date: "2026-06-23",
      description: "netto",
      amount: 53.79,
      cashChange: -53.79,
      documentNumber: "KAS-1218",
      accountCode: "4980",
      reconciled: true,
    });
  });

  it("maps old SIM suppliers without changing amount or tax", () => {
    const [entry] = normalizeMeinbuchImportEntries([makeEntry({
      sourceId: "kas:abcd1234:477",
      description: "Laycatel",
      amount: 550,
      taxRate: 19,
      taxAmount: 87.82,
      accountCode: "0000",
    })]);
    expect(entry).toMatchObject({ accountCode: "3430", amount: 550, taxRate: 19, taxAmount: 87.82 });
  });
});

function makeEntry(patch: Partial<LedgerEntry>): LedgerEntry {
  return {
    id: "ledger-1", date: "2026-01-01", direction: "expense", amount: 1,
    paymentMethod: "cash", description: "Altbuchung", category: "0000 · Nicht zugeordnet",
    source: "kasImport", sourceId: "kas:test:1", taxAmount: 0, taxRate: 0,
    taxMode: "taxFree", reconciled: false, accountCode: "0000", counterAccountCode: "1000",
    cashChange: -1, createdAt: "2026-01-01T12:00:00Z", ...patch,
  };
}
