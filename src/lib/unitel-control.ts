import { compareUnitelReportToLedger, type UnitelMonthlyReport } from "./unitel-report";
import type { BusinessDocument, LedgerEntry } from "./types";

export interface UnitelDocumentControl {
  report: UnitelMonthlyReport;
  recognizedEntries: number;
  ledgerTotal: number;
  difference: number;
  exact: boolean;
}

export function buildUnitelDocumentControl(
  document: BusinessDocument,
  ledger: LedgerEntry[],
): UnitelDocumentControl | undefined {
  if (document.metadata?.provider !== "UniTel") return undefined;

  const periodStart = text(document, "periodStart");
  const periodEnd = text(document, "periodEnd");
  const invoiceNumber = text(document, "invoiceNumber");
  const invoiceDate = text(document, "invoiceDate") || document.date;
  const totalCardValue = number(document, "totalCardValue");
  const commissionGross = number(document, "commissionGross");
  const commissionVat = number(document, "commissionVat");
  const commissionNet = number(document, "commissionNet");
  const payableAmount = number(document, "payableAmount");

  if (!periodStart || !periodEnd || !invoiceNumber || totalCardValue <= 0) return undefined;

  const report: UnitelMonthlyReport = {
    periodStart,
    periodEnd,
    customerNumber: text(document, "customerNumber"),
    invoiceNumber,
    invoiceDate,
    totalCardValue,
    commissionGross,
    commissionVat,
    commissionNet,
    payableAmount,
    sourceText: document.ocrText || "",
  };
  const comparison = compareUnitelReportToLedger(report, ledger);
  return { report, ...comparison };
}

function number(document: BusinessDocument, key: string): number {
  const value = document.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function text(document: BusinessDocument, key: string): string {
  const value = document.metadata?.[key];
  return typeof value === "string" ? value : "";
}
