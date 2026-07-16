import {
  createUnitelDailyImportPlan,
  parseUnitelDailyReport,
  type UnitelDailyImportPlan,
  type UnitelDailyReport,
} from "./unitel-daily-report";
import type { AppState, BusinessDocument, LedgerEntry } from "./types";

const TOLERANCE = 0.02;
const PIN_SALES_HEADER = [
  "Benutzername",
  "Kartenname",
  "Einkaufspreis",
  "Verkaufspreis",
  "Anzahl",
  "Einkaufssumme",
  "Verkaufssumme",
  "Gewinn",
  "Bestelldatum",
].join("\t");

export interface UnitelCashConflict {
  date: string;
  reportTotal: number;
  existingTotal: number;
  difference: number;
}

export interface UnitelCashImportPlan extends UnitelDailyImportPlan {
  importedDays: number;
  skippedExistingDays: number;
  skippedExistingCommissions: number;
  conflicts: UnitelCashConflict[];
  cashSalesTotal: number;
}

export function parseUnitelCashReport(text: string): UnitelDailyReport {
  return parseUnitelDailyReport(ensurePinSalesHeader(text));
}

export function createUnitelCashImportPlan(
  current: AppState,
  report: UnitelDailyReport,
  fileName: string,
  fileDataUrl?: string,
): UnitelCashImportPlan {
  const cashByDate = Object.fromEntries(report.days.map((day) => [day.date, day.salesTotal]));
  const basePlan = createUnitelDailyImportPlan(current, report, cashByDate, fileName, fileDataUrl);
  const existingDaily = existingUnitelCashByDate(current.ledger);
  const conflicts: UnitelCashConflict[] = [];
  const skippedDates = new Set<string>();

  for (const day of report.days) {
    const existingTotal = roundMoney(existingDaily.get(day.date) || 0);
    if (existingTotal <= TOLERANCE) continue;
    if (close(existingTotal, day.salesTotal)) {
      skippedDates.add(day.date);
      continue;
    }
    conflicts.push({
      date: day.date,
      reportTotal: day.salesTotal,
      existingTotal,
      difference: roundMoney(day.salesTotal - existingTotal),
    });
  }

  const existingCommissions = existingUnitelCommissionByMonth(current.ledger);
  let skippedExistingCommissions = 0;
  const entries = basePlan.entries
    .filter((entry) => {
      if (isDailySalesEntry(entry) && skippedDates.has(entry.date)) return false;
      if (!isCommissionEntry(entry)) return true;
      const month = entry.date.slice(0, 7);
      const existing = roundMoney(existingCommissions.get(month) || 0);
      if (!close(existing, entry.amount)) return true;
      skippedExistingCommissions += 1;
      return false;
    })
    .map(normalizeCommissionAccount);

  const importedDays = report.days.length - skippedDates.size - conflicts.length;
  const document: BusinessDocument = {
    ...basePlan.document,
    metadata: {
      ...basePlan.document.metadata,
      paymentAllocation: "all-cash-confirmed",
      cashSalesTotal: report.salesTotal,
      importedDays,
      skippedExistingDays: skippedDates.size,
      conflictDays: conflicts.length,
      createdLedgerEntries: entries.length,
      createdSalesEntries: entries.filter(isDailySalesEntry).length,
      createdCommissionEntries: entries.filter(isCommissionEntry).length,
    },
  };

  return {
    ...basePlan,
    document,
    entries,
    salesEntries: entries.filter(isDailySalesEntry).length,
    commissionEntries: entries.filter(isCommissionEntry).length,
    importedDays,
    skippedExistingDays: skippedDates.size,
    skippedExistingCommissions,
    conflicts,
    cashSalesTotal: report.salesTotal,
  };
}

export function ensurePinSalesHeader(text: string): string {
  const source = text.replace(/^\uFEFF/, "").replace(/\r/g, "");
  if (/Benutzername/i.test(source) && /Bestelldatum/i.test(source)) return source;
  const lines = source.split("\n");
  const firstDataIndex = lines.findIndex(looksLikePinSalesDataLine);
  if (firstDataIndex < 0) {
    throw new Error("In der Datei wurden keine Pin-Sales-/UniTel-Verkaufszeilen erkannt.");
  }
  return [PIN_SALES_HEADER, ...lines.slice(firstDataIndex)].join("\n");
}

function existingUnitelCashByDate(entries: LedgerEntry[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    if (!isExistingUnitelCashEntry(entry)) continue;
    totals.set(entry.date, roundMoney((totals.get(entry.date) || 0) + Math.max(0, entry.cashChange || 0)));
  }
  return totals;
}

function existingUnitelCommissionByMonth(entries: LedgerEntry[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    if (!isCommissionEntry(entry)) continue;
    const month = entry.date.slice(0, 7);
    totals.set(month, roundMoney((totals.get(month) || 0) + entry.amount));
  }
  return totals;
}

function isExistingUnitelCashEntry(entry: LedgerEntry): boolean {
  if (entry.paymentMethod !== "cash" || (entry.cashChange || 0) <= TOLERANCE) return false;
  const accountPair = new Set([entry.accountCode, entry.counterAccountCode]);
  if (!accountPair.has("1000") || !accountPair.has("1590")) return false;
  const text = `${entry.description} ${entry.category} ${entry.note || ""}`.toLowerCase();
  return entry.source === "unitelImport" || text.includes("unitel") || text.includes("guthaben");
}

function isDailySalesEntry(entry: LedgerEntry): boolean {
  return entry.source === "unitelImport" && entry.sourceId?.startsWith("unitel-sales:") === true;
}

function isCommissionEntry(entry: LedgerEntry): boolean {
  if (entry.sourceId?.startsWith("unitel-commission:") === true) return true;
  const text = `${entry.description} ${entry.category} ${entry.note || ""}`.toLowerCase();
  return entry.direction === "income" && ["8400", "8403"].includes(entry.accountCode || "") && text.includes("unitel") && text.includes("provision");
}

function normalizeCommissionAccount(entry: LedgerEntry): LedgerEntry {
  if (!isCommissionEntry(entry)) return entry;
  return {
    ...entry,
    accountCode: "8403",
    category: "8403 · Provisionserlöse 19 Prozent",
    description: entry.description.replace("Vermittlungsprovision", "Guthaben-Provision"),
  };
}

function looksLikePinSalesDataLine(line: string): boolean {
  const columns = line.split("\t").map((value) => value.trim());
  return columns.length >= 9 && /^\d{2}-\d{2}-\d{4}$/.test(columns[8]) && /€/.test(columns[2]) && /€/.test(columns[6]);
}

function close(left: number, right: number): boolean {
  return Math.abs(roundMoney(left - right)) <= TOLERANCE;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
