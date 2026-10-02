import { roundMoney } from "./accounting";
import { isMisclassifiedBankStatementEntry } from "./document-control";
import type { AppState, LedgerEntry } from "./types";

export interface FinanceMonth {
  month: string;
  revenueGross: number;
  revenueNet: number;
  expenseGross: number;
  expenseNet: number;
  profit: number;
  outputVat: number;
  inputVat: number;
  vatLiability: number;
  bookingCount: number;
}

export interface FinanceQuality {
  secureEntries: number;
  reviewEntries: number;
  missingReceiptEntries: number;
  openTransactions: number;
  score: number;
}

export interface FinanceForecast {
  year: number;
  months: FinanceMonth[];
  revenueGross: number;
  revenueNet: number;
  expenseGross: number;
  expenseNet: number;
  profit: number;
  outputVat: number;
  inputVat: number;
  vatLiability: number;
  monthsWithActivity: number;
  projectionFactor: number;
  projectedProfit: number;
  projectedVatLiability: number;
  taxableIncomeApprox: number;
  incomeTaxBeforeTradeCredit: number;
  tradeTaxMeasure: number;
  tradeTax: number;
  tradeTaxCredit: number;
  incomeTaxAfterTradeCredit: number;
  vatPrepayments: number;
  incomeTaxPrepayments: number;
  tradeTaxPrepayments: number;
  remainingVat: number;
  remainingIncomeTax: number;
  remainingTradeTax: number;
  recommendedReserve: number;
  quality: FinanceQuality;
  unsupportedIncomeTaxYear: boolean;
}

export function buildFinanceForecast(state: AppState, year: number, now = new Date()): FinanceForecast {
  const settings = state.settings;
  const entries = state.ledger.filter((entry) => entry.date.startsWith(`${year}-`) && isOperatingFinanceEntry(entry) && !isMisclassifiedBankStatementEntry(state, entry));
  const months = Array.from({ length: 12 }, (_, index) => buildMonth(entries, year, index + 1));
  const activeMonths = months.filter((month) => month.bookingCount > 0).length;
  const totals = months.reduce(
    (sum, month) => ({
      revenueGross: sum.revenueGross + month.revenueGross,
      revenueNet: sum.revenueNet + month.revenueNet,
      expenseGross: sum.expenseGross + month.expenseGross,
      expenseNet: sum.expenseNet + month.expenseNet,
      profit: sum.profit + month.profit,
      outputVat: sum.outputVat + month.outputVat,
      inputVat: sum.inputVat + month.inputVat,
      vatLiability: sum.vatLiability + month.vatLiability,
    }),
    { revenueGross: 0, revenueNet: 0, expenseGross: 0, expenseNet: 0, profit: 0, outputVat: 0, inputVat: 0, vatLiability: 0 },
  );

  const projectionFactor = projectionMultiplier(year, activeMonths, now);
  const projectedProfit = roundMoney(totals.profit * projectionFactor);
  const projectedVatLiability = roundMoney(totals.vatLiability * projectionFactor);
  const otherTaxableIncome = safeNumber(settings.otherTaxableIncome);
  const taxableIncomeApprox = roundMoney(Math.max(0, projectedProfit + otherTaxableIncome));
  const unsupportedIncomeTaxYear = year !== 2026;
  const incomeTaxBeforeTradeCredit = unsupportedIncomeTaxYear ? 0 : estimateIncomeTax2026(taxableIncomeApprox);
  const tradeTaxMultiplier = clamp(safeNumber(settings.tradeTaxMultiplier, 520), 200, 900);
  const trade = estimateTradeTax(projectedProfit, tradeTaxMultiplier);
  const tradeTaxCredit = unsupportedIncomeTaxYear
    ? 0
    : roundMoney(Math.min(incomeTaxBeforeTradeCredit, trade.measure * 4, trade.tax));
  const incomeTaxAfterTradeCredit = roundMoney(Math.max(0, incomeTaxBeforeTradeCredit - tradeTaxCredit));

  const vatPrepayments = safeNumber(settings.vatPrepayments);
  const incomeTaxPrepayments = safeNumber(settings.incomeTaxPrepayments);
  const tradeTaxPrepayments = safeNumber(settings.tradeTaxPrepayments);
  const remainingVat = roundMoney(Math.max(0, projectedVatLiability - vatPrepayments));
  const remainingIncomeTax = roundMoney(Math.max(0, incomeTaxAfterTradeCredit - incomeTaxPrepayments));
  const remainingTradeTax = roundMoney(Math.max(0, trade.tax - tradeTaxPrepayments));
  const recommendedReserve = roundMoney(remainingVat + remainingIncomeTax + remainingTradeTax);

  return {
    year,
    months: months.map(roundMonth),
    revenueGross: roundMoney(totals.revenueGross),
    revenueNet: roundMoney(totals.revenueNet),
    expenseGross: roundMoney(totals.expenseGross),
    expenseNet: roundMoney(totals.expenseNet),
    profit: roundMoney(totals.profit),
    outputVat: roundMoney(totals.outputVat),
    inputVat: roundMoney(totals.inputVat),
    vatLiability: roundMoney(totals.vatLiability),
    monthsWithActivity: activeMonths,
    projectionFactor,
    projectedProfit,
    projectedVatLiability,
    taxableIncomeApprox,
    incomeTaxBeforeTradeCredit,
    tradeTaxMeasure: trade.measure,
    tradeTax: trade.tax,
    tradeTaxCredit,
    incomeTaxAfterTradeCredit,
    vatPrepayments,
    incomeTaxPrepayments,
    tradeTaxPrepayments,
    remainingVat,
    remainingIncomeTax,
    remainingTradeTax,
    recommendedReserve,
    quality: buildQuality(state, year, entries),
    unsupportedIncomeTaxYear,
  };
}

export function estimateIncomeTax2026(zveInput: number): number {
  const x = Math.floor(Math.max(0, zveInput));
  let tax = 0;
  if (x <= 12_348) tax = 0;
  else if (x <= 17_799) {
    const y = (x - 12_348) / 10_000;
    tax = (914.51 * y + 1_400) * y;
  } else if (x <= 69_878) {
    const z = (x - 17_799) / 10_000;
    tax = (173.10 * z + 2_397) * z + 1_034.87;
  } else if (x <= 277_825) {
    tax = 0.42 * x - 11_135.63;
  } else {
    tax = 0.45 * x - 19_470.38;
  }
  return Math.max(0, Math.floor(tax));
}

export function estimateTradeTax(profitInput: number, multiplier = 520): { measure: number; tax: number } {
  const roundedTradeIncome = Math.floor(Math.max(0, profitInput) / 100) * 100;
  const taxableTradeIncome = Math.max(0, roundedTradeIncome - 24_500);
  const measure = roundMoney(taxableTradeIncome * 0.035);
  const tax = roundMoney(measure * (multiplier / 100));
  return { measure, tax };
}

function buildMonth(entries: LedgerEntry[], year: number, monthNumber: number): FinanceMonth {
  const month = `${year}-${String(monthNumber).padStart(2, "0")}`;
  const monthly = entries.filter((entry) => entry.date.startsWith(month));
  const income = monthly.filter((entry) => entry.direction === "income");
  const expenses = monthly.filter((entry) => entry.direction === "expense");
  const revenueGross = sum(income, (entry) => entry.amount);
  const expenseGross = sum(expenses, (entry) => entry.amount);
  const revenueNet = sum(income, financeNetValue);
  const expenseNet = sum(expenses, financeNetValue);
  const outputVat = sum(income, (entry) => entry.taxAmount || 0);
  const inputVat = sum(expenses, (entry) => entry.taxAmount || 0);
  return {
    month,
    revenueGross,
    revenueNet,
    expenseGross,
    expenseNet,
    profit: revenueNet - expenseNet,
    outputVat,
    inputVat,
    vatLiability: outputVat - inputVat,
    bookingCount: monthly.length,
  };
}

const NEUTRAL_ACCOUNT_CODES = new Set(["1000", "1200", "1360", "1370", "1590", "1591", "1592", "1800", "1890"]);

export function isOperatingFinanceEntry(entry: LedgerEntry): boolean {
  if (entry.direction === "transfer") return false;
  if (entry.manualKind === "transfer" || entry.manualKind === "private") return false;
  if (entry.accountCode && NEUTRAL_ACCOUNT_CODES.has(entry.accountCode)) return false;
  const text = `${entry.description} ${entry.category} ${entry.note || ""}`.toLowerCase();
  if (/(kasse an bank|bank an paypal|paypal an bank|flatpay-auszahlung|durchlaufende posten|unitel.*verrechnung|prifoto.*verrechnung)/.test(text)) return false;
  if (isTaxPayment(entry)) return false;
  return entry.direction === "income" || entry.direction === "expense";
}

function isTaxPayment(entry: LedgerEntry): boolean {
  const text = `${entry.description} ${entry.category} ${entry.note || ""}`.toLowerCase();
  return /(finanzamt|gewerbesteuer)/.test(text) &&
    /(umsatzsteuer|ust\b|einkommensteuer|est\b|gewerbesteuer|vorauszahlung)/.test(text);
}

export function financeNetValue(entry: LedgerEntry): number {
  if (typeof entry.netAmount === "number" && Number.isFinite(entry.netAmount)) return entry.netAmount;
  return roundMoney(entry.amount - Math.max(0, entry.taxAmount || 0));
}

function buildQuality(state: AppState, year: number, entries: LedgerEntry[]): FinanceQuality {
  const reviewEntries = entries.filter((entry) => !entry.reconciled || !entry.accountCode || entry.accountCode === "0000").length;
  const missingReceiptEntries = entries.filter((entry) => {
    if (entry.direction !== "expense" || entry.taxAmount > 0) return false;
    const text = `${entry.note || ""} ${entry.description}`.toLowerCase();
    return entry.source === "paypalImport" || text.includes("beleg fehlt") || text.includes("ohne vorsteuer");
  }).length;
  const openTransactions = state.importedTransactions.filter(
    (transaction) =>
      transaction.date.startsWith(`${year}-`) &&
      (transaction.status === "new" || transaction.status === "needsReview" || transaction.bookkeepingStatus === "unbooked"),
  ).length;
  const secureEntries = Math.max(0, entries.length - reviewEntries);
  const issues = reviewEntries + missingReceiptEntries + openTransactions;
  const denominator = Math.max(1, entries.length + openTransactions);
  const score = Math.max(0, Math.min(100, Math.round(100 - (issues / denominator) * 100)));
  return { secureEntries, reviewEntries, missingReceiptEntries, openTransactions, score };
}

function projectionMultiplier(year: number, activeMonths: number, now: Date): number {
  if (!activeMonths) return 1;
  if (year < now.getFullYear()) return 1;
  if (year > now.getFullYear()) return 1;
  return Math.max(1, Math.min(12, 12 / activeMonths));
}

function roundMonth(month: FinanceMonth): FinanceMonth {
  return {
    ...month,
    revenueGross: roundMoney(month.revenueGross),
    revenueNet: roundMoney(month.revenueNet),
    expenseGross: roundMoney(month.expenseGross),
    expenseNet: roundMoney(month.expenseNet),
    profit: roundMoney(month.profit),
    outputVat: roundMoney(month.outputVat),
    inputVat: roundMoney(month.inputVat),
    vatLiability: roundMoney(month.vatLiability),
  };
}

function sum(entries: LedgerEntry[], value: (entry: LedgerEntry) => number): number {
  return entries.reduce((total, entry) => total + value(entry), 0);
}

function safeNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
