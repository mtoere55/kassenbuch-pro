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

function makeBackup(blocks: Uint8Array[]) {
  const header = new Uint8Array(BLOCK_SIZE);
  new DataView(header.buffer).setUint32(0, 1, true);
  const allBlocks = [header, ...blocks];
  const output = new Uint8Array(allBlocks.length * BLOCK_SIZE);
  allBlocks.forEach((block, index) => output.set(block, index * BLOCK_SIZE));
  return output.buffer;
}

function fixture() {
  return makeBackup([
    categoryBlock(1, "Einnahmen", 8400, 1, 19),
    categoryBlock(2, "Burobedarf", 4930, 2, 19),
    transactionBlock({ id: 10, text: "Verkauf", day: 1, month: 7, year: 2025, category: 8400, sequence: 1, cents: 11900, taxRate: 19 }),
    transactionBlock({ id: 11, text: "Papier", day: 2, month: 7, year: 2025, category: 4930, sequence: 2, cents: -5950, taxRate: 19 }),
  ]);
}

function clearingFixture() {
  return makeBackup([
    transactionBlock({ id: 20, text: "Ria Money Transfer", day: 1, month: 4, year: 2026, category: 1591, sequence: 20, cents: 100000 }),
    transactionBlock({ id: 21, text: "Ria Auszahlung", day: 2, month: 4, year: 2026, category: 15911, sequence: 21, cents: -90000 }),
    transactionBlock({ id: 22, text: "Prifoto", day: 3, month: 4, year: 2026, category: 8401, sequence: 22, cents: 5000, taxRate: 19 }),
    transactionBlock({ id: 23, text: "@telcom Ersatzteil", day: 4, month: 4, year: 2026, category: 0, sequence: 23, cents: -11900, taxRate: 19 }),
  ]);
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
    expect(firstPlan.entries[0].documentNumber).toBe("KASSE-202507-0001");
    expect(firstPlan.entries[1].cashChange).toBe(-59.5);
    expect(firstPlan.entries[1].taxAmount).toBe(9.5);
    expect(firstPlan.entries[1].documentNumber).toBe("KASSE-202507-0002");

    const secondPlan = planBackupImport(backup, firstPlan.entries, "meinbuch.kas");
    expect(secondPlan.entries).toHaveLength(0);
    expect(secondPlan.duplicateCount).toBe(2);
  });

  it("automatically maps Ria, Prifoto and known spare-parts rows", () => {
    const backup = parseCashbookBackup(clearingFixture());
    const plan = planBackupImport(backup, [], "meinbuch.kas");
    expect(plan.unknownCategoryCount).toBe(0);
    expect(plan.entries.map((entry) => entry.accountCode)).toEqual(["1591", "1591", "1592", "3400"]);
    expect(plan.entries.slice(0, 3).every((entry) => entry.direction === "transfer")).toBe(true);
    expect(plan.entries[2]).toMatchObject({ taxRate: 0, taxAmount: 0, documentNumber: "KASSE-202604-0003" });
    expect(plan.entries[3]).toMatchObject({ direction: "expense", taxRate: 19, documentNumber: "KASSE-202604-0004" });
  });
});
