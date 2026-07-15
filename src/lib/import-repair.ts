import type { ImportedTransaction } from "./types";

const LEGACY_PDF_AMOUNT_FLOOR = 1_000_000_000_000;

export function isMalformedLegacyPdfImport(transaction: ImportedTransaction): boolean {
  const createdDate = transaction.createdAt.slice(0, 10);
  return transaction.accountType === "paypal" &&
    transaction.description === "Importierter Umsatz" &&
    Math.abs(transaction.amount) >= LEGACY_PDF_AMOUNT_FLOOR &&
    transaction.date === createdDate &&
    !transaction.externalId &&
    !transaction.relatedExternalId &&
    !transaction.matchedDocumentId &&
    !transaction.matchedLedgerEntryId &&
    !transaction.feeLedgerEntryId &&
    !transaction.bookkeepingStatus;
}
