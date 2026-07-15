import type { ImportedTransaction } from "./types";

const LEGACY_PDF_AMOUNT_FLOOR = 1_000_000_000_000;

export function isMalformedLegacyPdfImport(transaction: ImportedTransaction): boolean {
  const createdDate = transaction.createdAt.slice(0, 10);
  const legacyLabel = [transaction.description, transaction.counterparty]
    .filter(Boolean)
    .some((value) => normalize(String(value)) === "importierterumsatz");
  const unbooked = !transaction.bookkeepingStatus || transaction.bookkeepingStatus === "unbooked";

  return transaction.accountType === "paypal" &&
    legacyLabel &&
    Math.abs(transaction.amount) >= LEGACY_PDF_AMOUNT_FLOOR &&
    transaction.date === createdDate &&
    unbooked &&
    !transaction.matchedDocumentId &&
    !transaction.matchedLedgerEntryId &&
    !transaction.feeLedgerEntryId;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}
