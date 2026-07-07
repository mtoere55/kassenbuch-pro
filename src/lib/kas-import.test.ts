import { describe, expect, it } from "vitest";
import { buildKasImportPlan, parseKasBackup } from "./kas-import";

describe("KAS backup import", () => {
  it("reads accounts and signed cash transactions", () => {
    const file = joinBlocks([
      headerBlock(),
      accountBlock(1, "Einnahmen", 8400, 1, 1900),
      accountBlock(2, "Bürobedarf", 4930, 2, 1900),
      transactionBlock(10, "Verkauf", 2026, 3, 1, 8400, 11900, 1900, 7),
      transactionBlock(11, "Papier", 2026, 3, 2, 4930, -10700, 700, 8),
    ]);

    const parsed = parseKasBackup(file);
    expect(parsed.accounts).toHaveLength(2);
    expect(parsed.transactions).toHaveLength(2);
    expect(parsed.dateFrom).toBe("2026-03-01");
    expect(parsed.dateTo).toBe("2026-03-02");
    expect(parsed.transactions[0]).toMatchObject({
      direction: "income",
      amount: 119,
      vatRate: 19,
      taxAmount: 19,
      cashChange: 119,
    });
    expect(parsed.transactions[1]).toMatchObject({
      direction: "expense",
      amount: 107,
      vatRate: 7,
      taxAmount: 7,
      cashChange: -107,
    });
  });

  it("does not import the same KAS record twice", () => {
    const parsed = parseKasBackup(joinBlocks([
      headerBlock(),
      accountBlock(1, "Einnahmen", 8400, 1, 1900),
      transactionBlock(10, "Verkauf", 2026, 3, 1, 8400, 11900, 1900, 7),
    ]));
    const first = buildKasImportPlan(parsed, [], "book.kas");
    const second = buildKasImportPlan(parsed, first.entries, "book.kas");
    expect(first.entries).toHaveLength(1);
    expect(second.entries).toHaveLength(0);
    expect(second.duplicateCount).toBe(1);
  });

  it("rejects unsupported files", () => {
    expect(() => parseKasBackup(new Uint8Array(300))).toThrow(/Blockgröße/);
  });
});

function headerBlock() {
  const block = new Uint8Array(256);
  block.set([1, 0, 0, 0]);
  return block;
}

function accountBlock(id: number, label: string, code: number, kind: number, vat: number) {
  const block = recordBlock([1, 0, 1, 10], id);
  const next = writeText(block, 12, label);
  const view = new DataView(block.buffer);
  view.setInt32(next, code, true);
  view.setInt32(next + 4, kind, true);
  view.setInt32(next + 8, vat, true);
  return block;
}

function transactionBlock(
  id: number,
  text: string,
  year: number,
  month: number,
  day: number,
  account: number,
  amountCents: number,
  vat: number,
  receipt: number,
) {
  const block = recordBlock([1, 0, 1, 11], id);
  const next = writeText(block, 8, text);
  const view = new DataView(block.buffer);
  block[next] = day;
  block[next + 1] = month;
  view.setUint16(next + 2, year, true);
  view.setInt32(next + 4, 1000, true);
  view.setInt32(next + 8, account, true);
  view.setInt32(next + 16, receipt, true);
  view.setInt32(next + 20, amountCents, true);
  view.setInt32(next + 24, vat, true);
  return block;
}

function recordBlock(prefix: number[], id: number) {
  const block = new Uint8Array(256);
  block.set(prefix);
  new DataView(block.buffer).setUint32(4, id, true);
  return block;
}

function writeText(block: Uint8Array, offset: number, text: string) {
  const encoded = new TextEncoder().encode(text);
  block.set(encoded, offset);
  block[offset + encoded.length] = 0;
  return offset + encoded.length + 1;
}

function joinBlocks(blocks: Uint8Array[]) {
  const result = new Uint8Array(blocks.length * 256);
  blocks.forEach((block, index) => result.set(block, index * 256));
  return result;
}
