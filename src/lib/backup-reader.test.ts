import { describe, expect, it } from "vitest";
import { parseCashbookBackup, planBackupImport } from "./backup-reader";

const BLOCK_SIZE = 256;

function writeText(bytes: Uint8Array, offset: number, value: string): number {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index);
  }
  bytes[offset + value.length] = 0;
  return offset + value.length + 1;
}

function categoryBlock(id: number, name: string, code: number, kind: number, taxRate = 0) {
  const buffer = new ArrayBuffer(BLOCK_SIZE);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  view.setUint32(0, 0x0a010001, true);
  view.setUint32(4, id, true);
  view.setInt32(8, -1, true);
  const fields = writeText(bytes, 12, name);
  view.setUint32(fields, code, true);
  view.setUint32(fields + 4, kind, true);
  view.setUint32(fields + 8, taxRate * 100, true);
  return bytes;
}

function transactionBlock(input: {
  id: number;
  text: string;
  day: number;
  month: number;
  year: number;
  category: number;
  sequence: number;
  cents: number;
  taxRate?: number;
}) {
  const buffer = new ArrayBuffer(BLOCK_SIZE);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  view.setUint32(0, 0x0b010001, true);
  view.setUint32(4, input.id, true);
  const fields = writeText(bytes, 8, input.text);
  bytes[fields] = input.day;
  bytes[fields + 1] = input.month;
  bytes[fields + 2] = input.year & 0xff;
  bytes[fields + 3] = input.year >> 8;
  view.setUint32(fields + 4, 1000, true);
  view.setUint32(fields + 8, input.category, true);
  view.setUint32(fields + 12, 0, true);
  view.setUint32(fields + 16, input.sequence, true);
  view.setInt32(fields + 20, input.cents, true);
  view.setUint32(fields + 24, (input.taxRate ?? 0) * 100, true);
  return bytes;
}

function fixture() {
  const blocks = [
    new Uint8Array(BLOCK_SIZE),
    categoryBlock(1, "Einnahmen", 8400, 1, 19),
    categoryBlock(2, "Burobedarf", 4930, 2, 19),
    transactionBlock({ id: 10, text: "Verkauf", day: 1, month: 7, year: 2025, category: 8400, sequence: 1, cents: 11900, taxRate: 19 }),
    transactionBlock({ id: 11, text: "Papier", day: 2, month: 7, year: 2025, category: 4930, sequence: 2, cents: -5950, taxRate: 19 }),
  ];
  new DataView(blocks[0].buffer).setUint32(0, 1, true);
  const output = new Uint8Array(blocks.length * BLOCK_SIZE);
  blocks.forEach((block, index) => output.set(block, index * BLOCK_SIZE));
  return output.buffer;
}

describe("cashbook backup reader", () => {
  it("reads variable-length records, dates, signed cents and tax rates", () => {
    const backup = parseCashbookBackup(fixture());
    expect(backup.transactions).toHaveLength(2);
    expect(backup.startDate).toBe("2025-07-01");
    expect(backup.endDate).toBe("2025-07-02");
    expect(backup.incomeTotal).toBe(119);
    expect(backup.expenseTotal).toBe(59.5);
    expect(backup.transactions[1].signedAmount).toBe(-59.5);
    expect(backup.transactions[1].taxRate).toBe(19);
  });

  it("creates ledger entries and skips records imported from the same backup", () => {
    const backup = parseCashbookBackup(fixture());
    const firstPlan = planBackupImport(backup, [], "meinbuch.kas");
    expect(firstPlan.entries).toHaveLength(2);
    expect(firstPlan.entries[0].cashChange).toBe(119);
    expect(firstPlan.entries[1].cashChange).toBe(-59.5);
    expect(firstPlan.entries[1].taxAmount).toBe(9.5);

    const secondPlan = planBackupImport(backup, firstPlan.entries, "meinbuch.kas");
    expect(secondPlan.entries).toHaveLength(0);
    expect(secondPlan.duplicateCount).toBe(2);
  });
});
