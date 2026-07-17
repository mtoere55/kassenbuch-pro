import { makeId } from "./accounting";
import {
  createPeriodBookingNumberAllocator,
  validPeriodBookingNumber,
} from "./business-booking-rules";
import type {
  AppState,
  BusinessDocument,
  ImportedTransaction,
  LedgerEntry,
} from "./types";

const MONEY_TOLERANCE = 0.02;
const REPAIR_NOTE = "Historische Bargeldeinzahlung aus vorhandenem Kontoauszug als Kasse-an-Bank-Umbuchung repariert";

export function repairHistoricalCashDeposits(current: AppState): AppState {
  const depositTransactions = current.importedTransactions.filter(isCashDepositTransaction);
  if (!depositTransactions.length) return current;

  const ledger = [...current.ledger];
  const importedTransactions = [...current.importedTransactions];
  const transferNumber = createPeriodBookingNumberAllocator("UMB", ledger);
  let changed = false;

  for (const transaction of depositTransactions) {
    const amount = Math.abs(transaction.amount);
    const linkedIndex = findRepairableLedgerIndex(ledger, transaction, amount);
    const correctIndex = linkedIndex >= 0
      ? linkedIndex
      : findCorrectCashDepositIndex(ledger, transaction.date, amount);

    let entry: LedgerEntry;
    if (correctIndex >= 0) {
      const currentEntry = ledger[correctIndex];
      entry = normalizeCashDepositEntry(
        currentEntry,
        transaction,
        transferNumber,
        statementForTransaction(current.documents, transaction.date),
      );
      if (!sameEntry(currentEntry, entry)) {
        ledger[correctIndex] = entry;
        changed = true;
      }
    } else {
      entry = createCashDepositEntry(
        transaction,
        transferNumber,
        statementForTransaction(current.documents, transaction.date),
      );
      ledger.unshift(entry);
      changed = true;
    }

    const transactionIndex = importedTransactions.findIndex((item) => item.id === transaction.id);
    if (transactionIndex >= 0) {
      const normalizedTransaction: ImportedTransaction = {
        ...importedTransactions[transactionIndex],
        matchedLedgerEntryId: entry.id,
        suggestedAccountCode: "1200",
        status: "ignored",
        bookkeepingStatus: "reviewed",
      };
      if (!sameTransaction(importedTransactions[transactionIndex], normalizedTransaction)) {
        importedTransactions[transactionIndex] = normalizedTransaction;
        changed = true;
      }
    }
  }

  return changed ? { ...current, ledger, importedTransactions } : current;
}

export function isCashDepositTransaction(transaction: ImportedTransaction): boolean {
  if (transaction.accountType !== "bank" || transaction.amount <= 0) return false;
  const text = normalize(
    `${transaction.description || ""} ${transaction.counterparty || ""} ${transaction.invoiceNumber || ""}`,
  );
  return [
    "bargeldeinzahlung",
    "bareinzahlung",
    "sb einzahlung",
    "sb-einzahlung",
    "einzahlung sb",
    "einzahlung automat",
    "einzahlungsautomat",
    "kasse an bank",
  ].some((marker) => text.includes(marker));
}

function findRepairableLedgerIndex(
  ledger: LedgerEntry[],
  transaction: ImportedTransaction,
  amount: number,
): number {
  if (transaction.matchedLedgerEntryId) {
    const directIndex = ledger.findIndex((entry) => entry.id === transaction.matchedLedgerEntryId);
    if (directIndex >= 0 && canRepairLedgerEntry(ledger[directIndex], transaction.date, amount)) {
      return directIndex;
    }
  }

  if (transaction.externalId) {
    const sourceIndex = ledger.findIndex((entry) =>
      entry.sourceId === transaction.externalId && canRepairLedgerEntry(entry, transaction.date, amount),
    );
    if (sourceIndex >= 0) return sourceIndex;
  }

  return ledger.findIndex((entry) => {
    if (!canRepairLedgerEntry(entry, transaction.date, amount)) return false;
    const text = normalize(`${entry.description} ${entry.category} ${entry.note || ""}`);
    return isDepositText(text) || entry.accountCode === "0000";
  });
}

function findCorrectCashDepositIndex(ledger: LedgerEntry[], date: string, amount: number): number {
  return ledger.findIndex((entry) =>
    entry.date === date &&
    Math.abs(entry.amount - amount) <= MONEY_TOLERANCE &&
    entry.direction === "transfer" &&
    entry.accountCode === "1200" &&
    entry.counterAccountCode === "1000",
  );
}

function canRepairLedgerEntry(entry: LedgerEntry, date: string, amount: number): boolean {
  if (entry.date !== date || Math.abs(entry.amount - amount) > MONEY_TOLERANCE) return false;
  if (entry.source === "bankImport") return true;
  return entry.paymentMethod === "bank" &&
    ["0000", "1200", undefined].includes(entry.accountCode) &&
    !entry.documentId;
}

function createCashDepositEntry(
  transaction: ImportedTransaction,
  transferNumber: (date: string) => string,
  statement?: BusinessDocument,
): LedgerEntry {
  const amount = Math.abs(transaction.amount);
  return {
    id: makeId("ledger"),
    date: transaction.date,
    direction: "transfer",
    amount,
    paymentMethod: "bank",
    description: "Umbuchung Kasse an Bank",
    category: "1200 · Bank",
    source: "bankImport",
    sourceId: transaction.externalId || `cash-deposit-repair:${transaction.id}`,
    documentId: statement?.id,
    taxAmount: 0,
    taxRate: 0,
    taxMode: "taxFree",
    reconciled: true,
    accountCode: "1200",
    counterAccountCode: "1000",
    documentNumber: transferNumber(transaction.date),
    cashChange: -amount,
    netAmount: amount,
    attachmentFileName: statement?.originalFileName,
    attachmentDataUrl: statement?.originalImageDataUrl,
    manualKind: "transfer",
    note: REPAIR_NOTE,
    createdAt: new Date().toISOString(),
  };
}

function normalizeCashDepositEntry(
  entry: LedgerEntry,
  transaction: ImportedTransaction,
  transferNumber: (date: string) => string,
  statement?: BusinessDocument,
): LedgerEntry {
  const amount = Math.abs(transaction.amount);
  return {
    ...entry,
    date: transaction.date,
    direction: "transfer",
    amount,
    paymentMethod: "bank",
    description: "Umbuchung Kasse an Bank",
    category: "1200 · Bank",
    source: "bankImport",
    sourceId: entry.sourceId || transaction.externalId || `cash-deposit-repair:${transaction.id}`,
    documentId: entry.documentId || statement?.id,
    taxAmount: 0,
    taxRate: 0,
    taxMode: "taxFree",
    reconciled: true,
    accountCode: "1200",
    counterAccountCode: "1000",
    documentNumber: isTransferNumber(entry.documentNumber)
      ? entry.documentNumber
      : transferNumber(transaction.date),
    cashChange: -amount,
    netAmount: amount,
    attachmentFileName: entry.attachmentFileName || statement?.originalFileName,
    attachmentDataUrl: entry.attachmentDataUrl || statement?.originalImageDataUrl,
    manualKind: "transfer",
    note: appendNote(entry.note, REPAIR_NOTE),
  };
}

function statementForTransaction(documents: BusinessDocument[], date: string): BusinessDocument | undefined {
  return documents.find((document) => {
    const metadata = document.metadata || {};
    if (metadata.reportKind !== "Kontoauszug") return false;
    const start = String(metadata.periodStart || "");
    const end = String(metadata.periodEnd || "");
    return Boolean(start && end && date >= start && date <= end);
  });
}

function isTransferNumber(value?: string): boolean {
  return Boolean(value && /^UMB-\d{6}-\d{4}$/.test(value) && validPeriodBookingNumber(value));
}

function isDepositText(value: string): boolean {
  return [
    "bargeldeinzahlung",
    "bareinzahlung",
    "sb einzahlung",
    "einzahlung automat",
    "kasse an bank",
  ].some((marker) => value.includes(marker));
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function appendNote(current: string | undefined, addition: string): string {
  if (!current) return addition;
  return current.includes(addition) ? current : `${current} · ${addition}`;
}

function sameEntry(left: LedgerEntry, right: LedgerEntry): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameTransaction(left: ImportedTransaction, right: ImportedTransaction): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
