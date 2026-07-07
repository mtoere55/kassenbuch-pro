import { getTaxAmountFromGross, makeId } from "./accounting";
import { BOOKING_CATEGORIES, getBookingCategory } from "./accounts";
import { reconcileImportedState } from "./transaction-reconciliation";
import type {
  AppState,
  ImportedTransaction,
  LedgerDirection,
  LedgerEntry,
  PaymentMethod,
  TaxMode,
} from "./types";

export interface PayPalPostingResult {
  state: AppState;
  createdEntries: number;
  linkedEntries: number;
  transferEntries: number;
  feeEntries: number;
  reviewCount: number;
  skipped: number;
}

export interface PayPalReviewInput {
  description: string;
  accountCode: string;
  taxRate: 0 | 7 | 19;
  direction: LedgerDirection;
  paymentMethod: PaymentMethod;
}

export function preparePayPalBookkeeping(current: AppState): PayPalPostingResult {
  const reconciled = reconcileImportedState(current).state;
  const ledger = [...reconciled.ledger];
  const existingSourceIds = new Set(
    ledger.map((entry) => entry.sourceId).filter((value): value is string => Boolean(value)),
  );
  const transactionsByExternalId = new Map(
    reconciled.importedTransactions
      .filter((transaction) => transaction.accountType === "paypal" && transaction.externalId)
      .map((transaction) => [transaction.externalId as string, transaction]),
  );

  let createdEntries = 0;
  let linkedEntries = 0;
  let transferEntries = 0;
  let feeEntries = 0;
  let reviewCount = 0;
  let skipped = 0;

  const importedTransactions = reconciled.importedTransactions.map((transaction) => {
    if (transaction.accountType !== "paypal") return transaction;

    const sourceId = paypalSourceId(transaction);
    const existingBySource = ledger.find((entry) => entry.sourceId === sourceId);
    const matchedLedger = transaction.matchedLedgerEntryId
      ? ledger.find((entry) => entry.id === transaction.matchedLedgerEntryId)
      : undefined;

    if (matchedLedger) {
      const index = ledger.findIndex((entry) => entry.id === matchedLedger.id);
      ledger[index] = {
        ...matchedLedger,
        paymentMethod: "paypal",
        counterAccountCode: "1370",
        reconciled: true,
      };
      linkedEntries += 1;
      return {
        ...transaction,
        bookkeepingStatus: "reviewed" as const,
        suggestedAccountCode: matchedLedger.accountCode,
      };
    }

    if (existingBySource) {
      skipped += 1;
      return {
        ...transaction,
        matchedLedgerEntryId: existingBySource.id,
        bookkeepingStatus:
          transaction.bookkeepingStatus ||
          (isInternalTransfer(transaction) ? ("reviewed" as const) : ("booked" as const)),
        suggestedAccountCode: existingBySource.accountCode,
      };
    }

    const posting = createPayPalLedgerEntry(transaction, transactionsByExternalId);
    ledger.unshift(posting.entry);
    existingSourceIds.add(sourceId);
    createdEntries += 1;
    if (posting.internalTransfer) transferEntries += 1;
    if (posting.needsReview) reviewCount += 1;

    let feeEntryId: string | undefined;
    if ((transaction.feeAmount || 0) > 0) {
      const feeSourceId = `${sourceId}:fee`;
      if (!existingSourceIds.has(feeSourceId)) {
        const feeEntry = createPayPalFeeEntry(transaction, feeSourceId);
        ledger.unshift(feeEntry);
        existingSourceIds.add(feeSourceId);
        feeEntryId = feeEntry.id;
        createdEntries += 1;
        feeEntries += 1;
      }
    }

    return {
      ...transaction,
      matchedLedgerEntryId: posting.entry.id,
      bookkeepingStatus: posting.needsReview ? ("booked" as const) : ("reviewed" as const),
      suggestedAccountCode: posting.entry.accountCode,
      feeLedgerEntryId: feeEntryId || transaction.feeLedgerEntryId,
      status: posting.internalTransfer
        ? ("ignored" as const)
        : transaction.matchedDocumentId
          ? ("matched" as const)
          : ("needsReview" as const),
    };
  });

  return {
    createdEntries,
    linkedEntries,
    transferEntries,
    feeEntries,
    reviewCount,
    skipped,
    state: {
      ...reconciled,
      ledger,
      importedTransactions,
    },
  };
}

export function reviewPayPalTransaction(
  current: AppState,
  transactionId: string,
  input: PayPalReviewInput,
): AppState {
  const transaction = current.importedTransactions.find((item) => item.id === transactionId);
  if (!transaction || transaction.accountType !== "paypal") {
    throw new Error("Die PayPal-Transaktion wurde nicht gefunden.");
  }
  if (isInternalTransfer(transaction)) {
    throw new Error("Interne Umbuchungen müssen nicht als Einnahme oder Ausgabe geprüft werden.");
  }
  const account = getBookingCategory(input.accountCode);
  if (!account || input.accountCode === "0000") {
    throw new Error("Bitte ein gültiges Buchungskonto auswählen.");
  }
  const ledgerId = transaction.matchedLedgerEntryId;
  const ledgerEntry = ledgerId
    ? current.ledger.find((entry) => entry.id === ledgerId)
    : undefined;
  if (!ledgerEntry) {
    throw new Error("Die Transaktion wurde noch nicht in die Buchhaltung übernommen.");
  }

  const amount = Math.abs(transaction.grossAmount ?? transaction.amount);
  const taxMode = inferTaxMode(account.code, account.label, input.taxRate);
  const taxAmount =
    taxMode === "differential" || input.taxRate === 0
      ? 0
      : roundMoney(getTaxAmountFromGross(amount, input.taxRate));
  const updatedLedger: LedgerEntry = {
    ...ledgerEntry,
    direction: input.direction,
    amount,
    paymentMethod: input.paymentMethod,
    description: input.description.trim() || transaction.counterparty || transaction.description,
    category: `${account.code} · ${account.label}`,
    taxAmount,
    taxRate: taxMode === "differential" ? 0 : input.taxRate,
    taxMode,
    reconciled: true,
    accountCode: account.code,
    counterAccountCode: input.paymentMethod === "paypal" ? "1370" : paymentAccount(input.paymentMethod),
    cashChange: input.paymentMethod === "cash"
      ? input.direction === "income"
        ? amount
        : input.direction === "expense"
          ? -amount
          : 0
      : 0,
    netAmount: roundMoney(amount - taxAmount),
    note: addReviewNote(ledgerEntry.note),
  };

  return {
    ...current,
    ledger: current.ledger.map((entry) => (entry.id === updatedLedger.id ? updatedLedger : entry)),
    importedTransactions: current.importedTransactions.map((item) =>
      item.id === transaction.id
        ? {
            ...item,
            bookkeepingStatus: "reviewed" as const,
            suggestedAccountCode: account.code,
          }
        : item,
    ),
  };
}

export function suggestPayPalAccount(transaction: ImportedTransaction): string {
  const value = `${transaction.counterparty || ""} ${transaction.senderEmail || ""} ${transaction.description}`.toLowerCase();
  if (value.includes("google ireland")) return "4610";
  if (value.includes("checkdomain") || value.includes("softwarenetz") || value.includes("g2a.com")) return "4980";
  if (
    value.includes("ebay") ||
    value.includes("otara") ||
    value.includes("aliexpress") ||
    value.includes("berrybase") ||
    value.includes("mas trade") ||
    value.includes("joybuy")
  ) {
    return "3200";
  }
  return "0000";
}

export function isInternalTransfer(transaction: ImportedTransaction): boolean {
  return (
    transaction.transactionType === "bankFunding" ||
    transaction.transactionType === "bankWithdrawal"
  );
}

export function payPalBookkeepingStatusLabel(transaction: ImportedTransaction): string {
  if (transaction.bookkeepingStatus === "reviewed") return "Geprüft";
  if (transaction.bookkeepingStatus === "booked") return "Gebucht · prüfen";
  return "Noch nicht gebucht";
}

function createPayPalLedgerEntry(
  transaction: ImportedTransaction,
  transactionsByExternalId: Map<string, ImportedTransaction>,
): { entry: LedgerEntry; internalTransfer: boolean; needsReview: boolean } {
  const amount = Math.abs(transaction.grossAmount ?? transaction.amount);
  const sourceId = paypalSourceId(transaction);
  const createdAt = transaction.createdAt || new Date().toISOString();

  if (transaction.transactionType === "bankFunding") {
    return {
      internalTransfer: true,
      needsReview: false,
      entry: {
        id: makeId("ledger"),
        date: transaction.date,
        direction: "transfer",
        amount,
        paymentMethod: "bank",
        description: "Umbuchung Bank an PayPal",
        category: "1370 · PayPal",
        source: "paypalImport",
        sourceId,
        taxAmount: 0,
        taxRate: 0,
        taxMode: "taxFree",
        reconciled: true,
        accountCode: "1370",
        counterAccountCode: "1200",
        cashChange: 0,
        netAmount: amount,
        manualKind: "transfer",
        note: paypalReferenceNote(transaction),
        createdAt,
      },
    };
  }

  if (transaction.transactionType === "bankWithdrawal") {
    return {
      internalTransfer: true,
      needsReview: false,
      entry: {
        id: makeId("ledger"),
        date: transaction.date,
        direction: "transfer",
        amount,
        paymentMethod: "paypal",
        description: "Umbuchung PayPal an Bank",
        category: "1200 · Bank",
        source: "paypalImport",
        sourceId,
        taxAmount: 0,
        taxRate: 0,
        taxMode: "taxFree",
        reconciled: true,
        accountCode: "1200",
        counterAccountCode: "1370",
        cashChange: 0,
        netAmount: amount,
        manualKind: "transfer",
        note: paypalReferenceNote(transaction),
        createdAt,
      },
    };
  }

  const refund = transaction.transactionType === "refund";
  const related = transaction.relatedExternalId
    ? transactionsByExternalId.get(transaction.relatedExternalId)
    : undefined;
  const accountCode = refund && related
    ? suggestPayPalAccount(related)
    : suggestPayPalAccount(transaction);
  const account = getBookingCategory(accountCode) || BOOKING_CATEGORIES[0];
  const incoming = transaction.amount > 0;
  const direction: LedgerDirection = refund || incoming ? "income" : "expense";
  const description = refund
    ? `Rückzahlung ${transaction.counterparty || related?.counterparty || "PayPal"}`
    : `${direction === "income" ? "PayPal-Zahlung" : "PayPal-Ausgabe"} ${transaction.counterparty || ""}`.trim();

  return {
    internalTransfer: false,
    needsReview: true,
    entry: {
      id: makeId("ledger"),
      date: transaction.date,
      direction,
      amount,
      paymentMethod: "paypal",
      description,
      category: `${account.code} · ${account.label}`,
      source: "paypalImport",
      sourceId,
      documentId: transaction.matchedDocumentId,
      taxAmount: 0,
      taxRate: 0,
      taxMode: "taxFree",
      reconciled: Boolean(transaction.matchedDocumentId),
      accountCode: account.code,
      counterAccountCode: "1370",
      documentNumber: transaction.invoiceNumber,
      cashChange: 0,
      netAmount: amount,
      note: `${paypalReferenceNote(transaction)} · Steuer und Rechnung prüfen`,
      manualKind: direction === "income" ? "income" : "expense",
      createdAt,
    },
  };
}

function createPayPalFeeEntry(
  transaction: ImportedTransaction,
  sourceId: string,
): LedgerEntry {
  const amount = roundMoney(transaction.feeAmount || 0);
  const account = getBookingCategory("4970")!;
  return {
    id: makeId("ledger"),
    date: transaction.date,
    direction: "expense",
    amount,
    paymentMethod: "paypal",
    description: `PayPal-Gebühr ${transaction.counterparty || transaction.externalId || ""}`.trim(),
    category: `${account.code} · ${account.label}`,
    source: "paypalImport",
    sourceId,
    taxAmount: 0,
    taxRate: 0,
    taxMode: "taxFree",
    reconciled: true,
    accountCode: account.code,
    counterAccountCode: "1370",
    cashChange: 0,
    netAmount: amount,
    note: paypalReferenceNote(transaction),
    createdAt: transaction.createdAt || new Date().toISOString(),
  };
}

function paypalSourceId(transaction: ImportedTransaction): string {
  return `paypal:${transaction.externalId || transaction.id}`;
}

function paypalReferenceNote(transaction: ImportedTransaction): string {
  return [
    transaction.externalId ? `PayPal ${transaction.externalId}` : "PayPal-Import",
    transaction.relatedExternalId ? `verbunden ${transaction.relatedExternalId}` : "",
    transaction.invoiceNumber ? `Rechnung ${transaction.invoiceNumber}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function addReviewNote(note?: string): string {
  const review = "PayPal-Buchung manuell geprüft";
  if (note?.includes(review)) return note;
  return [note, review].filter(Boolean).join(" · ");
}

function inferTaxMode(code: string, label: string, taxRate: number): TaxMode {
  if (["3290", "8336", "8390"].includes(code) || /differenz|25a/i.test(label)) {
    return "differential";
  }
  return taxRate > 0 ? "standard19" : "taxFree";
}

function paymentAccount(method: PaymentMethod): string {
  return ({ cash: "1000", card: "1360", bank: "1200", paypal: "1370" } as const)[method];
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
