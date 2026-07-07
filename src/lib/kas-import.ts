import { getTaxAmountFromGross, makeId } from "./accounting";
import type { LedgerEntry, LedgerDirection, PaymentMethod, TaxMode } from "./types";

const BLOCK_SIZE = 256;
const HEADER_PREFIX = [0x01, 0x00, 0x00, 0x00];
const ACCOUNT_PREFIX = [0x01, 0x00, 0x01, 0x0a];
const TRANSACTION_PREFIX = [0x01, 0x00, 0x01, 0x0b];

export type KasAccountKind = "income" | "expense" | "neutral";

export interface KasAccount {
  recordId: number;
  code: number;
  label: string;
  kind: KasAccountKind;
  vatRate: 0 | 7 | 19;
}

export interface KasTransaction {
  recordId: number;
  date: string;
  description: string;
  paymentAccountCode: number;
  accountCode: number;
  accountLabel: string;
  receiptNumber?: number;
  signedAmountCents: number;
  amount: number;
  vatRate: 0 | 7 | 19;
  taxAmount: number;
  direction: LedgerDirection;
  paymentMethod: PaymentMethod;
  cashChange: number;
  taxMode: TaxMode;
  sourceId: string;
  manualKind: "income" | "expense" | "transfer" | "private";
  warning?: string;
}

export interface KasParseResult {
  accounts: KasAccount[];
  transactions: KasTransaction[];
  ignoredRecords: number;
  zeroAmountRecords: number;
  unknownAccountRecords: number;
  dateFrom?: string;
  dateTo?: string;
}

export interface KasImportPlan {
  entries: LedgerEntry[];
  duplicateCount: number;
  zeroAmountCount: number;
}

export function parseKasBackup(input: ArrayBuffer | Uint8Array): KasParseResult {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < BLOCK_SIZE || bytes.byteLength % BLOCK_SIZE !== 0) {
    throw new Error("Die KAS-Datei hat keine gültige Blockgröße.");
  }
  if (!matchesPrefix(bytes.subarray(0, BLOCK_SIZE), HEADER_PREFIX)) {
    throw new Error("Die Datei ist kein unterstütztes Kassenbuch-.kas-Backup.");
  }

  const accountBlocks: Uint8Array[] = [];
  const transactionBlocks: Uint8Array[] = [];
  let ignoredRecords = 0;

  for (let offset = BLOCK_SIZE; offset < bytes.byteLength; offset += BLOCK_SIZE) {
    const block = bytes.subarray(offset, offset + BLOCK_SIZE);
    if (matchesPrefix(block, ACCOUNT_PREFIX)) accountBlocks.push(block);
    else if (matchesPrefix(block, TRANSACTION_PREFIX)) transactionBlocks.push(block);
    else ignoredRecords += 1;
  }

  const accounts = accountBlocks.map(parseAccountBlock).filter(isDefined);
  const accountMap = new Map(accounts.map((account) => [account.code, account]));
  const transactions: KasTransaction[] = [];
  let zeroAmountRecords = 0;
  let unknownAccountRecords = 0;

  for (const block of transactionBlocks) {
    const parsed = parseTransactionBlock(block, accountMap);
    if (!parsed) {
      ignoredRecords += 1;
      continue;
    }
    if (parsed.signedAmountCents === 0) zeroAmountRecords += 1;
    if (!accountMap.has(parsed.accountCode)) unknownAccountRecords += 1;
    transactions.push(parsed);
  }

  const dates = transactions.map((transaction) => transaction.date).sort();
  return {
    accounts,
    transactions,
    ignoredRecords,
    zeroAmountRecords,
    unknownAccountRecords,
    dateFrom: dates[0],
    dateTo: dates.at(-1),
  };
}

export function buildKasImportPlan(
  parsed: KasParseResult,
  existingLedger: LedgerEntry[],
  fileName: string,
): KasImportPlan {
  const existingSourceIds = new Set(
    existingLedger.map((entry) => entry.sourceId).filter((value): value is string => Boolean(value)),
  );
  let duplicateCount = 0;
  let zeroAmountCount = 0;
  const entries: LedgerEntry[] = [];

  for (const transaction of parsed.transactions) {
    if (transaction.signedAmountCents === 0) {
      zeroAmountCount += 1;
      continue;
    }
    if (existingSourceIds.has(transaction.sourceId)) {
      duplicateCount += 1;
      continue;
    }
    entries.push(kasTransactionToLedgerEntry(transaction, fileName));
  }

  return { entries, duplicateCount, zeroAmountCount };
}

export function kasTransactionToLedgerEntry(
  transaction: KasTransaction,
  fileName: string,
): LedgerEntry {
  const accountCode = transaction.accountCode === 0 ? "0000" : String(transaction.accountCode);
  const documentNumber = transaction.receiptNumber
    ? `KAS-${transaction.receiptNumber}`
    : undefined;

  return {
    id: makeId("ledger"),
    date: transaction.date,
    direction: transaction.direction,
    amount: transaction.amount,
    paymentMethod: transaction.paymentMethod,
    description: transaction.description || transaction.accountLabel,
    category: `${accountCode} · ${transaction.accountLabel}`,
    source: "manual",
    sourceId: transaction.sourceId,
    taxAmount: transaction.taxAmount,
    taxRate: transaction.vatRate,
    taxMode: transaction.taxMode,
    reconciled: true,
    accountCode,
    counterAccountCode: String(transaction.paymentAccountCode),
    documentNumber,
    cashChange: transaction.cashChange,
    netAmount: roundMoney(transaction.amount - transaction.taxAmount),
    note: [
      `Import aus ${fileName}`,
      `KAS-Datensatz ${transaction.recordId}`,
      transaction.warning,
    ]
      .filter(Boolean)
      .join(" · "),
    manualKind: transaction.manualKind,
    createdAt: `${transaction.date}T12:00:00.000Z`,
  };
}

function parseAccountBlock(block: Uint8Array): KasAccount | undefined {
  try {
    const view = blockView(block);
    const recordId = view.getUint32(4, true);
    const labelResult = readCString(block, 12);
    const cursor = labelResult.next;
    if (cursor + 12 > block.byteLength) return undefined;
    const code = view.getInt32(cursor, true);
    const rawKind = view.getInt32(cursor + 4, true);
    const rawVat = view.getInt32(cursor + 8, true);
    return {
      recordId,
      code,
      label: labelResult.value.trim() || `Konto ${code}`,
      kind: rawKind === 1 ? "income" : rawKind === 2 ? "expense" : "neutral",
      vatRate: normalizeVatRate(rawVat),
    };
  } catch {
    return undefined;
  }
}

function parseTransactionBlock(
  block: Uint8Array,
  accountMap: Map<number, KasAccount>,
): KasTransaction | undefined {
  try {
    const view = blockView(block);
    const recordId = view.getUint32(4, true);
    const descriptionResult = readCString(block, 8);
    const cursor = descriptionResult.next;
    if (cursor + 32 > block.byteLength) return undefined;

    const day = block[cursor];
    const month = block[cursor + 1];
    const year = view.getUint16(cursor + 2, true);
    const date = isoDate(year, month, day);
    if (!date) return undefined;

    const paymentAccountCode = view.getInt32(cursor + 4, true);
    const accountCode = view.getInt32(cursor + 8, true);
    const receiptNumber = view.getInt32(cursor + 16, true);
    const signedAmountCents = view.getInt32(cursor + 20, true);
    const rawVat = view.getInt32(cursor + 24, true);
    const account = accountMap.get(accountCode);
    const amount = roundMoney(Math.abs(signedAmountCents) / 100);
    const vatRate = normalizeVatRate(rawVat);
    const direction = inferDirection(accountCode, account?.kind, signedAmountCents);
    const paymentMethod = paymentMethodFromAccount(paymentAccountCode);
    const manualKind = inferManualKind(accountCode, direction);
    const accountLabel = account?.label || "Nicht zugeordnet (Originalkonto 0)";
    const taxMode = inferTaxMode(accountCode, accountLabel, vatRate);
    const taxAmount = taxMode === "differential" || vatRate === 0
      ? 0
      : roundMoney(getTaxAmountFromGross(amount, vatRate));
    const warning = account
      ? undefined
      : `Originalkonto ${accountCode} konnte keinem Kontenplan-Eintrag zugeordnet werden`;

    return {
      recordId,
      date,
      description: descriptionResult.value.trim(),
      paymentAccountCode,
      accountCode,
      accountLabel,
      receiptNumber: receiptNumber > 0 ? receiptNumber : undefined,
      signedAmountCents,
      amount,
      vatRate,
      taxAmount,
      direction,
      paymentMethod,
      cashChange: paymentAccountCode === 1000 ? roundMoney(signedAmountCents / 100) : 0,
      taxMode,
      sourceId: stableSourceId({
        recordId,
        date,
        paymentAccountCode,
        accountCode,
        signedAmountCents,
        rawVat,
        description: descriptionResult.value,
      }),
      manualKind,
      warning,
    };
  } catch {
    return undefined;
  }
}

function inferDirection(
  accountCode: number,
  accountKind: KasAccountKind | undefined,
  signedAmountCents: number,
): LedgerDirection {
  if ([1200, 1360, 1800, 1890].includes(accountCode)) return "transfer";
  if (accountKind === "income") return signedAmountCents < 0 ? "expense" : "income";
  if (accountKind === "expense") return signedAmountCents > 0 ? "income" : "expense";
  return signedAmountCents < 0 ? "expense" : "income";
}

function inferManualKind(
  accountCode: number,
  direction: LedgerDirection,
): "income" | "expense" | "transfer" | "private" {
  if ([1800, 1890].includes(accountCode)) return "private";
  if ([1200, 1360].includes(accountCode) || direction === "transfer") return "transfer";
  return direction === "income" ? "income" : "expense";
}

function paymentMethodFromAccount(accountCode: number): PaymentMethod {
  if (accountCode === 1200) return "bank";
  if (accountCode === 1360) return "card";
  return "cash";
}

function inferTaxMode(accountCode: number, label: string, vatRate: number): TaxMode {
  if ([3290, 8390].includes(accountCode) || /differenz|§\s*25/i.test(label)) {
    return "differential";
  }
  return vatRate > 0 ? "standard19" : "taxFree";
}

function normalizeVatRate(rawVat: number): 0 | 7 | 19 {
  const percentage = Math.round(rawVat / 100);
  if (percentage === 7) return 7;
  if (percentage === 19) return 19;
  return 0;
}

function isoDate(year: number, month: number, day: number): string | undefined {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return undefined;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day
    .toString()
    .padStart(2, "0")}`;
}

function readCString(bytes: Uint8Array, start: number): { value: string; next: number } {
  let end = start;
  while (end < bytes.byteLength && bytes[end] !== 0) end += 1;
  if (end >= bytes.byteLength) throw new Error("Ungültiger Textblock");
  const value = new TextDecoder("windows-1252").decode(bytes.subarray(start, end));
  return { value, next: end + 1 };
}

function stableSourceId(input: {
  recordId: number;
  date: string;
  paymentAccountCode: number;
  accountCode: number;
  signedAmountCents: number;
  rawVat: number;
  description: string;
}): string {
  const payload = [
    input.recordId,
    input.date,
    input.paymentAccountCode,
    input.accountCode,
    input.signedAmountCents,
    input.rawVat,
    input.description.trim().toLowerCase(),
  ].join("|");
  return `kas:${input.recordId}:${fnv1a(payload)}`;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function matchesPrefix(block: Uint8Array, prefix: number[]): boolean {
  return prefix.every((value, index) => block[index] === value);
}

function blockView(block: Uint8Array): DataView {
  return new DataView(block.buffer, block.byteOffset, block.byteLength);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
