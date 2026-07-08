import { getTaxAmountFromGross } from "./accounting";
import { BOOKING_CATEGORIES, getBookingCategory, type BookingCategory } from "./accounts";
import type { AppState, LedgerDirection, LedgerEntry, PaymentMethod, TaxMode } from "./types";

export interface KasEntryCorrection {
  date: string;
  description: string;
  amount: number;
  direction: LedgerDirection;
  paymentMethod: PaymentMethod;
  accountCode: string;
  taxRate: 0 | 7 | 19;
}

export function isKasImportEntry(entry: LedgerEntry): boolean {
  return entry.source === "kasImport" || Boolean(entry.sourceId?.startsWith("kas:"));
}

export function isUnresolvedKasEntry(entry: LedgerEntry): boolean {
  return isKasImportEntry(entry) && (!entry.accountCode || entry.accountCode === "0000");
}

export function migrateKasImportSources(state: AppState): AppState {
  let changed = false;
  const ledger = state.ledger.map((entry) => {
    if (entry.sourceId?.startsWith("kas:") && entry.source !== "kasImport") {
      changed = true;
      return { ...entry, source: "kasImport" as const };
    }
    return entry;
  });
  return changed ? { ...state, version: Math.max(2, state.version || 1), ledger } : state;
}

export function ledgerSourceLabel(entry: LedgerEntry): string {
  if (isKasImportEntry(entry)) return "KAS-Import";
  return ({
    sale: "Verkauf",
    purchase: "Ankauf",
    scan: "Scanner",
    bankImport: "Bank-Import",
    paypalImport: "PayPal-Import",
    flatpayImport: "Flatpay-Import",
    unitelImport: "UniTel-Import",
    kasImport: "KAS-Import",
    manual: "Manuell",
  } as const)[entry.source];
}

export function buildReviewAccountOptions(ledger: LedgerEntry[]): BookingCategory[] {
  const map = new Map(BOOKING_CATEGORIES.map((account) => [account.code, account]));
  ledger.filter(isKasImportEntry).forEach((entry) => {
    if (!entry.accountCode || map.has(entry.accountCode)) return;
    const label = entry.category.split("·").slice(1).join("·").trim() || "Importiertes Konto";
    map.set(entry.accountCode, {
      code: entry.accountCode,
      label,
      side:
        entry.direction === "income"
          ? "in"
          : entry.direction === "expense"
            ? "out"
            : "neutral",
      vat: entry.taxRate === 7 ? 7 : entry.taxRate === 19 ? 19 : 0,
    });
  });
  return [...map.values()].sort((left, right) =>
    left.code.localeCompare(right.code, "de", { numeric: true }),
  );
}

export function correctKasEntry(
  entry: LedgerEntry,
  correction: KasEntryCorrection,
  accountOptions: BookingCategory[],
): LedgerEntry {
  if (!isKasImportEntry(entry)) {
    throw new Error("Nur importierte KAS-Buchungen können hier korrigiert werden.");
  }
  if (!correction.date) throw new Error("Bitte ein Datum auswählen.");
  if (!Number.isFinite(correction.amount) || correction.amount <= 0) {
    throw new Error("Bitte einen gültigen Betrag eingeben.");
  }

  const account =
    accountOptions.find((item) => item.code === correction.accountCode) ||
    getBookingCategory(correction.accountCode);
  if (!account || correction.accountCode === "0000") {
    throw new Error("Bitte ein gültiges Buchungskonto auswählen.");
  }

  const taxMode = inferTaxMode(account.code, account.label, correction.taxRate);
  const taxAmount =
    taxMode === "differential" || correction.taxRate === 0
      ? 0
      : roundMoney(getTaxAmountFromGross(correction.amount, correction.taxRate));
  const cashChange = calculateCashChange(entry, correction);
  const paymentAccount = {
    cash: "1000",
    card: "1360",
    bank: "1200",
    paypal: "1370",
  }[correction.paymentMethod];
  const reviewedNote = "KAS-Buchung manuell geprueft";

  return {
    ...entry,
    date: correction.date,
    description: correction.description.trim() || account.label,
    amount: roundMoney(correction.amount),
    direction: correction.direction,
    paymentMethod: correction.paymentMethod,
    category: `${account.code} · ${account.label}`,
    source: "kasImport",
    taxAmount,
    taxRate: correction.taxRate,
    taxMode,
    reconciled: true,
    accountCode: account.code,
    counterAccountCode: paymentAccount,
    cashChange,
    netAmount: roundMoney(correction.amount - taxAmount),
    manualKind:
      correction.direction === "transfer"
        ? "transfer"
        : correction.direction === "income"
          ? "income"
          : "expense",
    note: entry.note?.includes(reviewedNote)
      ? entry.note
      : [entry.note, reviewedNote].filter(Boolean).join(" · "),
  };
}

function calculateCashChange(
  entry: LedgerEntry,
  correction: KasEntryCorrection,
): number {
  if (correction.paymentMethod !== "cash") return 0;
  if (correction.direction === "income") return roundMoney(correction.amount);
  if (correction.direction === "expense") return -roundMoney(correction.amount);
  if ((entry.cashChange || 0) > 0) return roundMoney(correction.amount);
  if ((entry.cashChange || 0) < 0) return -roundMoney(correction.amount);
  return 0;
}

function inferTaxMode(code: string, label: string, taxRate: number): TaxMode {
  if (["3290", "8336", "8390"].includes(code) || /differenz|25a/i.test(label)) {
    return "differential";
  }
  return taxRate > 0 ? "standard19" : "taxFree";
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
