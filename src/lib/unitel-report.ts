import { makeId } from "./accounting";
import type { AppState, BusinessDocument, LedgerEntry } from "./types";

const TOLERANCE = 0.02;

export interface UnitelMonthlyReport {
  periodStart: string;
  periodEnd: string;
  customerNumber: string;
  invoiceNumber: string;
  invoiceDate: string;
  totalCardValue: number;
  commissionGross: number;
  commissionVat: number;
  commissionNet: number;
  payableAmount: number;
  sourceText: string;
}

export interface UnitelValidation {
  valid: boolean;
  issues: string[];
}

export interface UnitelLedgerComparison {
  recognizedEntries: number;
  ledgerTotal: number;
  difference: number;
  exact: boolean;
}

export interface UnitelArchivePlan {
  document: BusinessDocument;
  comparison: UnitelLedgerComparison;
}

export function parseUnitelMonthlyReport(text: string): UnitelMonthlyReport {
  const normalized = text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  if (!/UNITEL\s+GMBH/i.test(normalized)) {
    throw new Error("Das PDF ist keine unterstützte UniTel-Abrechnung.");
  }

  const period = normalized.match(/Lieferung\s+von\s+(\d{2}\.\d{2}\.\d{4})\s+bis\s+(\d{2}\.\d{2}\.\d{4})/i);
  const customer = normalized.match(/KundenNr\.?\s*:\s*([A-Z0-9-]+)/i);
  const invoice = normalized.match(/Rechnung\s+Nr\.?\s*:\s*([A-Z0-9-]+)\s+Datum\s*:\s*(\d{2}\.\d{2}\.\d{4})/i);
  if (!period) throw new Error("Der Lieferzeitraum konnte nicht erkannt werden.");
  if (!invoice) throw new Error("Rechnungsnummer oder Rechnungsdatum konnte nicht erkannt werden.");

  const totalCardValue = labeledMoney(normalized, /(?:^|\s)Gesamt\s+([\d.]+,\d{2})(?=\s+Provision\s+Brutto)/i, "Gesamt");
  const commissionGross = labeledMoney(normalized, /Provision\s+Brutto\s+([\d.]+,\d{2})/i, "Provision Brutto");
  const commissionVat = labeledMoney(normalized, /19,00\s*%\s*MwSt\.?\s+auf\s+Vermittlungsprovision\s+([\d.]+,\d{2})/i, "Provision MwSt.");
  const commissionNet = labeledMoney(normalized, /Netto\s+Provision\s+([\d.]+,\d{2})/i, "Netto Provision");
  const payableAmount = labeledMoney(normalized, /Zu\s+zahlender\s+Betrag\s*\/\s*Rech\.?betrag\s+([\d.]+,\d{2})/i, "Rechnungsbetrag");

  return {
    periodStart: parseGermanDate(period[1]),
    periodEnd: parseGermanDate(period[2]),
    customerNumber: customer?.[1] || "",
    invoiceNumber: invoice[1],
    invoiceDate: parseGermanDate(invoice[2]),
    totalCardValue,
    commissionGross,
    commissionVat,
    commissionNet,
    payableAmount,
    sourceText: text,
  };
}

export function validateUnitelMonthlyReport(report: UnitelMonthlyReport): UnitelValidation {
  const issues: string[] = [];
  if (report.periodEnd < report.periodStart) issues.push("Das Ende des Lieferzeitraums liegt vor dem Anfang.");
  if (report.invoiceDate < report.periodEnd) issues.push("Das Rechnungsdatum liegt vor dem Ende des Lieferzeitraums.");
  if (report.totalCardValue <= 0) issues.push("Der Gesamtwert der Guthaben-Verkäufe ist nicht gültig.");
  if (report.commissionGross < 0 || report.commissionVat < 0 || report.commissionNet < 0 || report.payableAmount < 0) {
    issues.push("Die Abrechnung enthält einen negativen oder ungültigen Betrag.");
  }
  if (!close(report.commissionNet + report.commissionVat, report.commissionGross)) {
    issues.push("Netto-Provision plus MwSt. stimmt nicht mit der Brutto-Provision überein.");
  }
  if (!close(report.commissionNet * 0.19, report.commissionVat)) {
    issues.push("Die ausgewiesene MwSt. entspricht nicht 19 % der Netto-Provision.");
  }
  if (!close(report.totalCardValue - report.commissionGross, report.payableAmount)) {
    issues.push("Gesamtwert minus Brutto-Provision stimmt nicht mit dem Rechnungsbetrag überein.");
  }
  return { valid: issues.length === 0, issues };
}

export function compareUnitelReportToLedger(
  report: UnitelMonthlyReport,
  ledger: LedgerEntry[],
): UnitelLedgerComparison {
  const entries = ledger.filter((entry) =>
    entry.date >= report.periodStart &&
    entry.date <= report.periodEnd &&
    isUnitelLedgerEntry(entry),
  );
  const ledgerTotal = roundMoney(entries.reduce((sum, entry) => sum + signedLedgerAmount(entry), 0));
  const difference = roundMoney(report.totalCardValue - ledgerTotal);
  return {
    recognizedEntries: entries.length,
    ledgerTotal,
    difference,
    exact: Math.abs(difference) <= TOLERANCE,
  };
}

export function createUnitelArchivePlan(
  current: AppState,
  report: UnitelMonthlyReport,
  fileName: string,
  fileDataUrl?: string,
): UnitelArchivePlan {
  const validation = validateUnitelMonthlyReport(report);
  if (!validation.valid) throw new Error(validation.issues.join(" "));
  const fingerprint = unitelFingerprint(report);
  const duplicate = current.documents.find((document) => document.metadata?.unitelFingerprint === fingerprint);
  if (duplicate) throw new Error(`Diese UniTel-Abrechnung wurde bereits als ${duplicate.documentNumber} archiviert.`);

  const comparison = compareUnitelReportToLedger(report, current.ledger);
  const document: BusinessDocument = {
    id: makeId("document"),
    documentNumber: `UNITEL-${report.invoiceNumber}`,
    type: "zReport",
    date: report.invoiceDate,
    amount: report.totalCardValue,
    taxAmount: report.commissionVat,
    taxMode: "standard19",
    status: "archived",
    originalFileName: fileName,
    originalImageDataUrl: fileDataUrl,
    ocrText: report.sourceText,
    metadata: {
      provider: "UniTel",
      reportKind: "Guthaben-Monatsabrechnung",
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      customerNumber: report.customerNumber,
      invoiceNumber: report.invoiceNumber,
      invoiceDate: report.invoiceDate,
      totalCardValue: report.totalCardValue,
      commissionGross: report.commissionGross,
      commissionVat: report.commissionVat,
      commissionNet: report.commissionNet,
      payableAmount: report.payableAmount,
      recognizedLedgerEntries: comparison.recognizedEntries,
      recognizedLedgerTotal: comparison.ledgerTotal,
      difference: comparison.difference,
      unitelFingerprint: fingerprint,
      internallyValidated: true,
      matchedExistingLedger: comparison.exact,
      createdLedgerEntries: 0,
    },
    createdAt: new Date().toISOString(),
  };
  return { document, comparison };
}

export function unitelFingerprint(report: UnitelMonthlyReport): string {
  return `unitel:${report.invoiceNumber}:${report.invoiceDate}:${report.totalCardValue.toFixed(2)}:${report.commissionGross.toFixed(2)}`;
}

export function isUnitelLedgerEntry(entry: LedgerEntry): boolean {
  const haystack = [entry.description, entry.category, entry.note, entry.documentNumber]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /unitel|uni\s*tel|guthaben|cash\s*card|telefonkart/.test(haystack);
}

function signedLedgerAmount(entry: LedgerEntry): number {
  if (entry.direction === "income") return entry.amount;
  if (entry.direction === "expense") return -entry.amount;
  return typeof entry.cashChange === "number" ? entry.cashChange : 0;
}

function labeledMoney(text: string, pattern: RegExp, label: string): number {
  const match = text.match(pattern);
  if (!match) throw new Error(`${label} konnte nicht erkannt werden.`);
  return parseGermanMoney(match[1]);
}

function parseGermanMoney(value: string): number {
  const parsed = Number(value.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(parsed)) throw new Error(`Ungültiger Betrag: ${value}`);
  return roundMoney(parsed);
}

function parseGermanDate(value: string): string {
  const [day, month, year] = value.split(".");
  return `${year}-${month}-${day}`;
}

function close(left: number, right: number): boolean {
  return Math.abs(roundMoney(left - right)) <= TOLERANCE;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
