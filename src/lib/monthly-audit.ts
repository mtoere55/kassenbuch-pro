import { roundMoney } from "./accounting";
import { financeNetValue, isOperatingFinanceEntry } from "./finance-tax";
import { entryCashEffect } from "./manual-booking";
import type { AppState, LedgerEntry, PaymentMethod } from "./types";

export type MonthlyAuditSeverity = "info" | "warning" | "danger";
export type MonthlyAuditStatus = "empty" | "ok" | "info" | "warning" | "danger";

export interface MonthlyAuditIssue {
  code: string;
  severity: MonthlyAuditSeverity;
  title: string;
  detail: string;
  entryIds?: string[];
}

export interface MonthlyAuditGroup {
  label: string;
  amount: number;
  count: number;
}

export interface MonthlyAudit {
  month: string;
  status: MonthlyAuditStatus;
  bookingCount: number;
  issueCount: number;
  issues: MonthlyAuditIssue[];
  revenueNet: number;
  expenseNet: number;
  profitNet: number;
  outputVat: number;
  inputVat: number;
  vatLiability: number;
  devicePurchaseGross: number;
  deviceSaleGross: number;
  repairIncomeGross: number;
  transferVolume: number;
  paymentTotals: Record<PaymentMethod, number>;
  unresolvedCount: number;
  duplicateGroupCount: number;
  negativeCashDays: number;
  belowCostSales: number;
  unusualEntryCount: number;
  topExpenses: LedgerEntry[];
  topIncome: LedgerEntry[];
  expenseGroups: MonthlyAuditGroup[];
}

const TRANSFER_TEXT =
  /(kasse an bank|bank an kasse|bank an paypal|paypal an bank|flatpay-auszahlung|durchlaufende posten|unitel.*verrechnung|prifoto.*verrechnung)/i;

export function buildMonthlyAudits(state: AppState, year: number): MonthlyAudit[] {
  return Array.from({ length: 12 }, (_, index) =>
    buildMonthlyAudit(state, `${year}-${String(index + 1).padStart(2, "0")}`),
  );
}

export function buildMonthlyAudit(state: AppState, month: string): MonthlyAudit {
  const monthEntries = state.ledger.filter((entry) => entry.date.startsWith(month));
  const operating = monthEntries.filter(isOperatingFinanceEntry);
  const income = operating.filter((entry) => entry.direction === "income");
  const expenses = operating.filter((entry) => entry.direction === "expense");

  const revenueNet = sum(income, financeNetValue);
  const expenseNet = sum(expenses, financeNetValue);
  const outputVat = sum(income, (entry) => entry.taxAmount || 0);
  const inputVat = sum(expenses, (entry) => entry.taxAmount || 0);

  const unresolved = monthEntries.filter(
    (entry) => entry.accountCode === "0000" || entry.reconciled === false,
  );
  const duplicateGroups = findDuplicateGroups(monthEntries);
  const missingReceipt = expenses.filter(
    (entry) =>
      entry.taxAmount > 0 &&
      !entry.documentId &&
      !entry.documentNumber &&
      !entry.attachmentFileName &&
      !entry.attachmentDataUrl,
  );
  const transferLikeMisclassified = monthEntries.filter(
    (entry) =>
      entry.direction !== "transfer" &&
      entry.manualKind !== "transfer" &&
      entry.manualKind !== "private" &&
      TRANSFER_TEXT.test(`${entry.description} ${entry.category} ${entry.note || ""}`),
  );
  const taxAnomalies = operating.filter(
    (entry) =>
      !Number.isFinite(entry.taxAmount) ||
      entry.taxAmount < -0.005 ||
      entry.taxAmount - entry.amount > 0.005,
  );
  const belowCostDevices = state.devices.filter(
    (device) =>
      device.saleDate?.startsWith(month) &&
      typeof device.salePrice === "number" &&
      device.salePrice + 0.005 < device.purchasePrice + (device.repairCosts || 0),
  );

  const unusualEntries = findUnusualEntries(operating);
  const negativeCash = negativeCashDays(state, month);

  const issues: MonthlyAuditIssue[] = [];
  if (unresolved.length) {
    issues.push({
      code: "unresolved",
      severity: "danger",
      title: `${unresolved.length} ungeklärte Buchung(en)`,
      detail: "Mindestens eine Buchung ist nicht abgeglichen oder verwendet Konto 0000.",
      entryIds: unresolved.map((entry) => entry.id),
    });
  }
  if (negativeCash.length) {
    issues.push({
      code: "negative-cash",
      severity: "danger",
      title: `Kassenbestand an ${negativeCash.length} Tag(en) negativ`,
      detail: `Betroffene Tage: ${negativeCash.join(", ")}. Kassenbewegungen und Anfangsbestand prüfen.`,
    });
  }
  if (duplicateGroups.length) {
    issues.push({
      code: "duplicates",
      severity: "warning",
      title: `${duplicateGroups.length} mögliche Doppelbuchung(en)`,
      detail: "Gleicher Tag, Betrag, Zahlungsweg, Konto und Buchungstext kommen mehrfach vor.",
      entryIds: duplicateGroups.flatMap((group) => group.map((entry) => entry.id)),
    });
  }
  if (missingReceipt.length) {
    issues.push({
      code: "missing-receipt",
      severity: "warning",
      title: `${missingReceipt.length} Ausgabe(n) mit Steuer ohne Belegreferenz`,
      detail: "Für Vorsteuer-relevante Ausgaben sollte eine Beleg- oder Dokumentreferenz vorhanden sein.",
      entryIds: missingReceipt.map((entry) => entry.id),
    });
  }
  if (transferLikeMisclassified.length) {
    issues.push({
      code: "transfer-classification",
      severity: "warning",
      title: `${transferLikeMisclassified.length} Umbuchung(en) auffällig klassifiziert`,
      detail: "Der Text sieht nach Umbuchung/Clearing aus, die Buchung ist aber als Einnahme oder Ausgabe gespeichert.",
      entryIds: transferLikeMisclassified.map((entry) => entry.id),
    });
  }
  if (taxAnomalies.length) {
    issues.push({
      code: "tax-anomaly",
      severity: "warning",
      title: `${taxAnomalies.length} Steuerwert(e) unplausibel`,
      detail: "Steuerbetrag ist negativ, größer als der Buchungsbetrag oder technisch ungültig.",
      entryIds: taxAnomalies.map((entry) => entry.id),
    });
  }
  if (belowCostDevices.length) {
    issues.push({
      code: "below-cost-sale",
      severity: "warning",
      title: `${belowCostDevices.length} Gerät(e) unter Einstand verkauft`,
      detail: "Verkaufspreis liegt unter Einkauf plus erfassten Reparaturkosten.",
    });
  }
  if (unusualEntries.length) {
    issues.push({
      code: "unusual-amount",
      severity: "info",
      title: `${unusualEntries.length} ungewöhnlich hohe Einzelbuchung(en)`,
      detail: "Diese Beträge liegen deutlich über dem typischen Buchungswert des Monats und sollten kurz gegengeprüft werden.",
      entryIds: unusualEntries.map((entry) => entry.id),
    });
  }
  if (operating.length && revenueNet - expenseNet < 0) {
    issues.push({
      code: "negative-result",
      severity: "info",
      title: "Monatsergebnis negativ",
      detail: `Netto-Ausgaben übersteigen die Netto-Erlöse um ${money(Math.abs(revenueNet - expenseNet))}.`,
    });
  }

  const paymentTotals: Record<PaymentMethod, number> = {
    cash: 0,
    card: 0,
    bank: 0,
    paypal: 0,
  };
  operating.forEach((entry) => {
    paymentTotals[entry.paymentMethod] += entry.amount;
  });

  const devicePurchaseGross = sum(
    expenses.filter(
      (entry) => entry.source === "purchase" || /wareneinkauf gebraucht/i.test(entry.category),
    ),
    (entry) => entry.amount,
  );
  const deviceSaleGross = sum(
    income.filter((entry) => entry.source === "sale"),
    (entry) => entry.amount,
  );
  const repairIncomeGross = sum(
    income.filter((entry) => entry.source === "repair"),
    (entry) => entry.amount,
  );
  const transferEntries = monthEntries.filter(
    (entry) =>
      entry.direction === "transfer" ||
      entry.manualKind === "transfer" ||
      entry.manualKind === "private" ||
      TRANSFER_TEXT.test(`${entry.description} ${entry.category} ${entry.note || ""}`),
  );

  const status = auditStatus(monthEntries.length, issues);

  return {
    month,
    status,
    bookingCount: monthEntries.length,
    issueCount: issues.length,
    issues,
    revenueNet: roundMoney(revenueNet),
    expenseNet: roundMoney(expenseNet),
    profitNet: roundMoney(revenueNet - expenseNet),
    outputVat: roundMoney(outputVat),
    inputVat: roundMoney(inputVat),
    vatLiability: roundMoney(outputVat - inputVat),
    devicePurchaseGross: roundMoney(devicePurchaseGross),
    deviceSaleGross: roundMoney(deviceSaleGross),
    repairIncomeGross: roundMoney(repairIncomeGross),
    transferVolume: roundMoney(sum(transferEntries, (entry) => Math.abs(entry.amount))),
    paymentTotals: {
      cash: roundMoney(paymentTotals.cash),
      card: roundMoney(paymentTotals.card),
      bank: roundMoney(paymentTotals.bank),
      paypal: roundMoney(paymentTotals.paypal),
    },
    unresolvedCount: unresolved.length,
    duplicateGroupCount: duplicateGroups.length,
    negativeCashDays: negativeCash.length,
    belowCostSales: belowCostDevices.length,
    unusualEntryCount: unusualEntries.length,
    topExpenses: [...expenses].sort((a, b) => b.amount - a.amount).slice(0, 5),
    topIncome: [...income].sort((a, b) => b.amount - a.amount).slice(0, 5),
    expenseGroups: buildExpenseGroups(expenses),
  };
}

function findDuplicateGroups(entries: LedgerEntry[]): LedgerEntry[][] {
  const groups = new Map<string, LedgerEntry[]>();
  entries.forEach((entry) => {
    const description = entry.description.trim().toLowerCase().replace(/\s+/g, " ");
    const key = [
      entry.date,
      entry.direction,
      entry.amount.toFixed(2),
      entry.paymentMethod,
      entry.accountCode || "",
      description,
    ].join("|");
    const group = groups.get(key) || [];
    group.push(entry);
    groups.set(key, group);
  });
  return [...groups.values()].filter((group) => group.length > 1);
}

function findUnusualEntries(entries: LedgerEntry[]): LedgerEntry[] {
  if (entries.length < 4) return [];
  const amounts = entries.map((entry) => entry.amount).filter((amount) => amount > 0).sort((a, b) => a - b);
  if (!amounts.length) return [];
  const middle = Math.floor(amounts.length / 2);
  const median =
    amounts.length % 2 === 0
      ? (amounts[middle - 1] + amounts[middle]) / 2
      : amounts[middle];
  const total = amounts.reduce((value, amount) => value + amount, 0);
  const threshold = Math.max(1500, median * 5);
  return entries.filter(
    (entry) => entry.amount >= threshold && entry.amount >= total * 0.35,
  );
}

function negativeCashDays(state: AppState, month: string): string[] {
  const entries = [...state.ledger].sort((a, b) =>
    `${a.date}|${a.createdAt}`.localeCompare(`${b.date}|${b.createdAt}`),
  );
  let balance = state.settings.openingCash || 0;
  const days = new Set<string>();
  entries.forEach((entry) => {
    balance = roundMoney(balance + entryCashEffect(entry));
    if (entry.date.startsWith(month) && balance < -0.005) days.add(entry.date);
  });
  return [...days];
}

function buildExpenseGroups(expenses: LedgerEntry[]): MonthlyAuditGroup[] {
  const groups = new Map<string, MonthlyAuditGroup>();
  expenses.forEach((entry) => {
    const code = entry.accountCode || entry.category.match(/^(\d{4})/)?.[1] || "–";
    const label = entry.category.split("·").slice(1).join("·").trim() || entry.category || "Ohne Kategorie";
    const key = `${code}|${label}`;
    const current = groups.get(key) || { label: `${code} · ${label}`, amount: 0, count: 0 };
    current.amount += entry.amount;
    current.count += 1;
    groups.set(key, current);
  });
  return [...groups.values()]
    .map((group) => ({ ...group, amount: roundMoney(group.amount) }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);
}

function auditStatus(entryCount: number, issues: MonthlyAuditIssue[]): MonthlyAuditStatus {
  if (!entryCount) return "empty";
  if (issues.some((issue) => issue.severity === "danger")) return "danger";
  if (issues.some((issue) => issue.severity === "warning")) return "warning";
  if (issues.some((issue) => issue.severity === "info")) return "info";
  return "ok";
}

function sum(entries: LedgerEntry[], value: (entry: LedgerEntry) => number): number {
  return entries.reduce((total, entry) => total + value(entry), 0);
}

function money(value: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value);
}
