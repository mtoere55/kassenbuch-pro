import { isChangeAllowed } from "./bookkeeping-rules";
import {
  buildReviewAccountOptions,
  correctKasEntry as correctBaseKasEntry,
  isKasImportEntry,
  isUnresolvedKasEntry,
  ledgerSourceLabel,
  migrateKasImportSources,
  type KasEntryCorrection,
} from "./kas-review";
import type { BookingCategory } from "./accounts";
import type { LedgerEntry } from "./types";

export {
  buildReviewAccountOptions,
  isKasImportEntry,
  isUnresolvedKasEntry,
  ledgerSourceLabel,
  migrateKasImportSources,
};
export type { KasEntryCorrection };

export function correctKasEntry(
  entry: LedgerEntry,
  correction: KasEntryCorrection,
  accountOptions: BookingCategory[],
): LedgerEntry {
  if (!isChangeAllowed(entry.date)) {
    throw new Error("Diese Buchung ist ab dem Echtbetriebsdatum gesperrt. Öffne zuerst den Inhaberbereich.");
  }
  return correctBaseKasEntry(entry, correction, accountOptions);
}
