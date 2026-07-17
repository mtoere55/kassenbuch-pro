import { makeId } from "./accounting";
import { getBookingCategory } from "./accounts";
import {
  applyConfiguredBusinessRules,
  createPeriodBookingNumberAllocator,
  normalizeRuleText,
  validPeriodBookingNumber,
} from "./business-booking-rules";
import { repairHistoricalCashDeposits } from "./cash-deposit-repair";
import { normalizeSaleAccountingState } from "./sale-accounting-normalizer";
import type {
  AppState,
  ImportedTransaction,
  LedgerDirection,
  LedgerEntry,
  PaymentMethod,
} from "./types";

export interface LearnedBookingRule {
  id: string;
  keyword: string;
  label: string;
  amountDirection: "incoming" | "outgoing";
  accountCode: string;
  direction: LedgerDirection;
  paymentMethod: PaymentMethod;
  taxRate: 0 | 7 | 19;
  documentRequired: boolean;
  createdAt: string;
}

export interface LearnedBookingRuleInput {
  keyword: string;
  label: string;
  accountCode: string;
  direction: LedgerDirection;
  paymentMethod: PaymentMethod;
  taxRate: 0 | 7 | 19;
  documentRequired: boolean;
}

type RuleAwareState = AppState & { bookingRules?: LearnedBookingRule[] };

const MANUAL_REVIEW_MARKER = "Bank-PDF-Buchung manuell geprüft";
const LEARNED_RULE_MARKER = "Gelernte Bankregel";

export function getLearnedBookingRules(state: AppState): LearnedBookingRule[] {
  const rules = (state as RuleAwareState).bookingRules;
  return Array.isArray(rules) ? rules : [];
}

export function createLearnedBookingRule(
  transaction: ImportedTransaction,
  input: LearnedBookingRuleInput,
): LearnedBookingRule {
  const keyword = normalizeRuleText(input.keyword);
  if (keyword.length < 3) {
    throw new Error("Der Regelschlüssel muss mindestens drei Zeichen enthalten.");
  }
  return {
    id: makeId("rule"),
    keyword,
    label: input.label.trim() || transaction.counterparty || transaction.description,
    amountDirection: transaction.amount >= 0 ? "incoming" : "outgoing",
    accountCode: input.accountCode,
    direction: input.direction,
    paymentMethod: input.paymentMethod,
    taxRate: input.taxRate,
    documentRequired: input.documentRequired,
    createdAt: new Date().toISOString(),
  };
}

export function upsertLearnedBookingRule(state: AppState, rule: LearnedBookingRule): AppState {
  const normalizedKeyword = normalizeRuleText(rule.keyword);
  const rules = getLearnedBookingRules(state).filter(
    (item) => !(
      normalizeRuleText(item.keyword) === normalizedKeyword &&
      item.amountDirection === rule.amountDirection
    ),
  );
  return {
    ...state,
    bookingRules: [{ ...rule, keyword: normalizedKeyword }, ...rules],
  } as AppState;
}

export function applyBookkeepingRulesSafely(current: AppState): AppState {
  const original = current;
  current = repairHistoricalCashDeposits(current);
  current = normalizeSaleAccountingState(current);
  const rules = getLearnedBookingRules(current)
    .slice()
    .sort((left, right) => right.keyword.length - left.keyword.length);
  const bankAllocator = createPeriodBookingNumberAllocator("BANK", current.ledger);
  const transferAllocator = createPeriodBookingNumberAllocator("UMB", current.ledger);
  const ledgerById = new Map(current.ledger.map((entry) => [entry.id, entry]));
  const protectedTransactionIds = new Set<string>();
  const learnedTransactions = new Map<string, ImportedTransaction>();
  let changed = false;

  for (const transaction of current.importedTransactions) {
    if (transaction.accountType !== "bank" || !transaction.matchedLedgerEntryId) continue;
    const entry = ledgerById.get(transaction.matchedLedgerEntryId);
    if (!entry || entry.source !== "bankImport") continue;

    if (entry.note?.includes(MANUAL_REVIEW_MARKER)) {
      protectedTransactionIds.add(transaction.id);
      continue;
    }

    const learnedRule = findLearnedRule(transaction, rules);
    if (!learnedRule) continue;

    const updated = applyLearnedRule(transaction, entry, learnedRule, bankAllocator, transferAllocator);
    ledgerById.set(entry.id, updated.entry);
    learnedTransactions.set(transaction.id, updated.transaction);
    protectedTransactionIds.add(transaction.id);
    if (!sameLedgerEntry(entry, updated.entry) || !sameTransaction(transaction, updated.transaction)) {
      changed = true;
    }
  }

  const learnedLedger = current.ledger.map((entry) => ledgerById.get(entry.id) || entry);
  const builtInInput: AppState = {
    ...current,
    ledger: learnedLedger,
    importedTransactions: current.importedTransactions.filter(
      (transaction) => !protectedTransactionIds.has(transaction.id),
    ),
  };
  const builtInResult = applyConfiguredBusinessRules(builtInInput);
  const builtInTransactions = new Map(
    builtInResult.importedTransactions.map((transaction) => [transaction.id, transaction]),
  );
  const importedTransactions = current.importedTransactions.map((transaction) =>
    learnedTransactions.get(transaction.id) ||
    (protectedTransactionIds.has(transaction.id)
      ? transaction
      : builtInTransactions.get(transaction.id) || transaction),
  );
  const nextState = {
    ...builtInResult,
    importedTransactions,
    bookingRules: getLearnedBookingRules(current),
  } as AppState;

  if (!changed && builtInResult === builtInInput) return current;
  return sameState(original, nextState) ? original : nextState;
}

function findLearnedRule(
  transaction: ImportedTransaction,
  rules: LearnedBookingRule[],
): LearnedBookingRule | undefined {
  const direction = transaction.amount >= 0 ? "incoming" : "outgoing";
  const text = normalizeRuleText(
    `${transaction.counterparty || ""} ${transaction.description} ${transaction.invoiceNumber || ""}`,
  );
  return rules.find(
    (rule) => rule.amountDirection === direction && text.includes(normalizeRuleText(rule.keyword)),
  );
}

function applyLearnedRule(
  transaction: ImportedTransaction,
  entry: LedgerEntry,
  rule: LearnedBookingRule,
  bankAllocator: (date: string) => string,
  transferAllocator: (date: string) => string,
): { entry: LedgerEntry; transaction: ImportedTransaction } {
  const amount = Math.abs(transaction.amount);
  const account = getBookingCategory(rule.accountCode);
  const taxRate = rule.documentRequired ? 0 : rule.taxRate;
  const taxAmount = taxRate ? roundMoney((amount * taxRate) / (100 + taxRate)) : 0;
  const allocator = rule.direction === "transfer" ? transferAllocator : bankAllocator;
  const documentNumber = validPeriodBookingNumber(entry.documentNumber)
    ? entry.documentNumber
    : allocator(entry.date);
  const manualKind = rule.direction === "transfer"
    ? ["1800", "1890"].includes(rule.accountCode) ? "private" : "transfer"
    : rule.direction;
  const note = appendNote(
    entry.note,
    `${LEARNED_RULE_MARKER}: ${rule.keyword}${rule.documentRequired ? " · Beleg erforderlich" : ""}`,
  );
  const updatedEntry: LedgerEntry = {
    ...entry,
    documentNumber,
    direction: rule.direction,
    paymentMethod: rule.paymentMethod,
    description: rule.label,
    category: `${rule.accountCode} · ${account?.label || rule.label}`,
    accountCode: rule.accountCode,
    counterAccountCode: paymentAccount(rule.paymentMethod),
    taxRate,
    taxAmount,
    taxMode: taxRate ? "standard19" : "taxFree",
    netAmount: roundMoney(amount - taxAmount),
    cashChange: cashEffect(rule.paymentMethod, rule.direction, amount),
    reconciled: !rule.documentRequired,
    manualKind,
    note,
  };
  const updatedTransaction: ImportedTransaction = {
    ...transaction,
    suggestedAccountCode: rule.accountCode,
    status: rule.documentRequired ? "needsReview" : "matched",
    bookkeepingStatus: rule.documentRequired ? "booked" : "reviewed",
  };
  return { entry: updatedEntry, transaction: updatedTransaction };
}

function paymentAccount(method: PaymentMethod): string {
  return ({ cash: "1000", card: "1360", bank: "1200", paypal: "1370" } as const)[method];
}

function cashEffect(method: PaymentMethod, direction: LedgerDirection, amount: number): number {
  if (method !== "cash") return 0;
  if (direction === "income") return amount;
  if (direction === "expense") return -amount;
  return 0;
}

function appendNote(current: string | undefined, addition: string): string {
  if (!current) return addition;
  return current.includes(addition) ? current : `${current} · ${addition}`;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function sameLedgerEntry(left: LedgerEntry, right: LedgerEntry): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameTransaction(left: ImportedTransaction, right: ImportedTransaction): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameState(left: AppState, right: AppState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
