import { getTaxAmountFromGross, makeId } from "./accounting";
import type { LedgerEntry, LedgerDirection, TaxMode } from "./types";

const BLOCK_SIZE = 256;
const ACCOUNT_BLOCK = 0x0a010001;
const TRANSACTION_BLOCK = 0x0b010001;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export interface BackupCategory {
  recordId: number;
  parentId: number;
  code: number;
  name: string;
  kind: 0 | 1 | 2;
  taxRate: number;
}

export interface BackupTransaction {
  recordId: number;
  sequence: number;
  date: string;
  description: string;
  accountCode: number;
  categoryCode: number;
  signedAmount: number;
  taxRate: number;
}

export interface CashbookBackup {
  fingerprint: string;
  categories: BackupCategory[];
  transactions: BackupTransaction[];
  warnings: string[];
  startDate?: string;
  endDate?: string;
  incomeTotal: number;
  expenseTotal: number;
}

export interface BackupImportPlan {
  entries: LedgerEntry[];
  duplicateCount: number;
  unknownCategoryCount: number;
}

export function parseCashbookBackup(buffer: ArrayBuffer): CashbookBackup {
  if (buffer.byteLength === 0) throw new Error("Die Backup-Datei ist leer.");
  if (buffer.byteLength > MAX_FILE_SIZE) throw new Error("Die Backup-Datei darf maximal 10 MB groß sein.");
  if (buffer.byteLength % BLOCK_SIZE !== 0) {
    throw new Error("Die Datei hat kein unterstütztes Kassenbuch-Blockformat.");
  }

  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 1) {
    throw new Error("Die Datei ist kein erkanntes Kassenbuch-Backup.");
  }

  const categories: BackupCategory[] = [];
  const transactions: BackupTransaction[] = [];
  const warnings: string[] = [];
  const blockCount = buffer.byteLength / BLOCK_SIZE;

  for (let blockIndex = 1; blockIndex < blockCount; blockIndex += 1) {
    const offset = blockIndex * BLOCK_SIZE;
    const blockType = view.getUint32(offset, true);
    try {
      if (blockType === ACCOUNT_BLOCK) {
        categories.push(parseCategory(bytes, view, offset));
      } else if (blockType === TRANSACTION_BLOCK) {
        transactions.push(parseTransaction(bytes, view, offset));
      }
    } catch (cause) {
      warnings.push(
        `Block ${blockIndex} konnte nicht gelesen werden: ${cause instanceof Error ? cause.message : "unbekannter Fehler"}`,
      );
    }
  }

  if (!transactions.length) {
    throw new Error("In der Backup-Datei wurden keine Buchungen gefunden.");
  }

  transactions.sort((left, right) => `${left.date}|${left.recordId}`.localeCompare(`${right.date}|${right.recordId}`));
  const dates = transactions.map((transaction) => transaction.date).filter(Boolean);
  const incomeTotal = roundMoney(
    transactions.filter((transaction) => transaction.signedAmount > 0).reduce((sum, transaction) => sum + transaction.signedAmount, 0),
  );
  const expenseTotal = roundMoney(
    transactions.filter((transaction) => transaction.signedAmount < 0).reduce((sum, transaction) => sum + Math.abs(transaction.signedAmount), 0),
  );

  return {
    fingerprint: fingerprintBuffer(bytes),
    categories,
    transactions,
    warnings,
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    incomeTotal,
    expenseTotal,
  };
}

export function planBackupImport(
  backup: CashbookBackup,
  existingEntries: LedgerEntry[],
  fileName: string,
): BackupImportPlan {
  const existingSourceIds = new Set(existingEntries.map((entry) => entry.sourceId).filter(Boolean));
  const categoryMap = new Map(backup.categories.map((category) => [category.code, category]));
  const entries: LedgerEntry[] = [];
  let duplicateCount = 0;
  let unknownCategoryCount = 0;

  for (const transaction of backup.transactions) {
    const sourceId = backupSourceId(backup.fingerprint, transaction.recordId);
    if (existingSourceIds.has(sourceId)) {
      duplicateCount += 1;
      continue;
    }

    const category = categoryMap.get(transaction.categoryCode);
    if (!category) unknownCategoryCount += 1;
    entries.push(createLedgerEntry(transaction, category, sourceId, fileName));
  }

  return { entries, duplicateCount, unknownCategoryCount };
}

export function backupSourceId(fingerprint: string, recordId: number): string {
  return `backup:${fingerprint}:${recordId}`;
}

function parseCategory(bytes: Uint8Array, view: DataView, offset: number): BackupCategory {
  const recordId = view.getUint32(offset + 4, true);
  const parentId = view.getInt32(offset + 8, true);
  const nameField = readCString(bytes, offset + 12, offset + BLOCK_SIZE);
  const fieldsOffset = nameField.nextOffset;
  ensureAvailable(fieldsOffset, 12, offset + BLOCK_SIZE);
  const rawKind = view.getUint32(fieldsOffset + 4, true);

  return {
    recordId,
    parentId,
    name: cleanText(nameField.value),
    code: view.getUint32(fieldsOffset, true),
    kind: rawKind === 1 || rawKind === 2 ? rawKind : 0,
    taxRate: normalizeTaxRate(view.getUint32(fieldsOffset + 8, true)),
  };
}

function parseTransaction(bytes: Uint8Array, view: DataView, offset: number): BackupTransaction {
  const recordId = view.getUint32(offset + 4, true);
  const textField = readCString(bytes, offset + 8, offset + BLOCK_SIZE);
  const fieldsOffset = textField.nextOffset;
  ensureAvailable(fieldsOffset, 28, offset + BLOCK_SIZE);

  const day = bytes[fieldsOffset];
  const month = bytes[fieldsOffset + 1];
  const year = bytes[fieldsOffset + 2] + bytes[fieldsOffset + 3] * 256;
  if (!isValidDate(year, month, day)) {
    throw new Error(`Ungültiges Datum ${day}.${month}.${year}`);
  }

  return {
    recordId,
    description: cleanText(textField.value),
    date: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    accountCode: view.getUint32(fieldsOffset + 4, true),
    categoryCode: view.getUint32(fieldsOffset + 8, true),
    sequence: view.getUint32(fieldsOffset + 16, true),
    signedAmount: roundMoney(view.getInt32(fieldsOffset + 20, true) / 100),
    taxRate: normalizeTaxRate(view.getUint32(fieldsOffset + 24, true)),
  };
}

function createLedgerEntry(
  transaction: BackupTransaction,
  category: BackupCategory | undefined,
  sourceId: string,
  fileName: string,
): LedgerEntry {
  const amount = Math.abs(transaction.signedAmount);
  const classification = classifyTransaction(transaction, category);
  const differential = transaction.categoryCode === 3290 || transaction.categoryCode === 8390;
  const taxRate = differential ? 0 : transaction.taxRate || category?.taxRate || 0;
  const taxAmount = taxRate ? getTaxAmountFromGross(amount, taxRate) : 0;
  const taxMode: TaxMode = differential ? "differential" : taxRate ? "standard19" : "taxFree";
  const accountLabel = category?.name || "Nicht zugeordnet";
  const accountCode = transaction.categoryCode ? String(transaction.categoryCode) : undefined;
  const documentNumber = transaction.sequence
    ? `ALT-${transaction.sequence}`
    : `ALT-${transaction.recordId}`;

  return {
    id: makeId("ledger"),
    date: transaction.date,
    direction: classification.direction,
    amount,
    paymentMethod: "cash",
    description: transaction.description || accountLabel,
    category: `${accountCode || "–"} · ${accountLabel}`,
    source: "manual",
    sourceId,
    taxAmount,
    taxRate,
    taxMode,
    reconciled: true,
    accountCode,
    counterAccountCode: String(transaction.accountCode || 1000),
    documentNumber,
    cashChange: transaction.signedAmount,
    netAmount: roundMoney(amount - taxAmount),
    note: `Backup-Import aus ${fileName}; Original-ID ${transaction.recordId}`,
    manualKind: classification.manualKind,
    createdAt: `${transaction.date}T12:00:00.000Z`,
  };
}

function classifyTransaction(
  transaction: BackupTransaction,
  category: BackupCategory | undefined,
): { direction: LedgerDirection; manualKind: "income" | "expense" | "transfer" | "private" } {
  if (transaction.categoryCode === 1800 || transaction.categoryCode === 1890) {
    return { direction: "transfer", manualKind: "private" };
  }
  if (transaction.categoryCode === 1200 || transaction.categoryCode === 1360) {
    return { direction: "transfer", manualKind: "transfer" };
  }
  if (transaction.signedAmount < 0 || (transaction.signedAmount === 0 && category?.kind === 2)) {
    return { direction: "expense", manualKind: "expense" };
  }
  return { direction: "income", manualKind: "income" };
}

function readCString(bytes: Uint8Array, start: number, limit: number): { value: string; nextOffset: number } {
  let end = start;
  while (end < limit && bytes[end] !== 0) end += 1;
  if (end >= limit) throw new Error("Textfeld ist nicht abgeschlossen.");
  const decoder = new TextDecoder("windows-1252");
  return { value: decoder.decode(bytes.slice(start, end)), nextOffset: end + 1 };
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeTaxRate(rawValue: number): number {
  const rate = rawValue / 100;
  return rate === 7 || rate === 19 ? rate : 0;
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function ensureAvailable(offset: number, length: number, limit: number) {
  if (offset + length > limit) throw new Error("Backup-Datensatz ist unvollständig.");
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function fingerprintBuffer(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
