import { getTaxAmountFromGross, makeId } from "./accounting";
import type { AppState, BusinessDocument, LedgerEntry, PaymentMethod } from "./types";

export interface FlatpaySalesReport {
  startDate: string;
  endDate: string;
  cashSales: number;
  cardSales: number;
  otherSales: number;
  cashRefunds: number;
  cardRefunds: number;
  otherRefunds: number;
  totalSales: number;
  tips: number;
  surcharge: number;
  zeroNet: number;
  zeroVat: number;
  zeroGross: number;
  standardNet: number;
  standardVat: number;
  standardGross: number;
  sourceText: string;
}

export interface FlatpayValidation {
  valid: boolean;
  issues: string[];
}

export interface FlatpayLedgerComparison {
  cash: number;
  card: number;
  other: number;
  total: number;
  zeroGross: number;
  standardGross: number;
  standardVat: number;
  cashZero: number;
  cardZero: number;
  cashStandard: number;
  cardStandard: number;
  differences: {
    cash: number;
    card: number;
    total: number;
    zeroGross: number;
    standardGross: number;
    standardVat: number;
  };
  exact: boolean;
}

export interface FlatpayTaxAllocation {
  zeroCash: number;
  zeroCard: number;
  zeroOther?: number;
}

export interface FlatpayImportPlan {
  document: BusinessDocument;
  entries: LedgerEntry[];
  comparison: FlatpayLedgerComparison;
  alreadyMatched: boolean;
}

const TOLERANCE = 0.02;
const REVENUE_ACCOUNTS = new Set(["8336", "8390", "8400", "8600"]);

export function parseFlatpaySalesReport(text: string): FlatpaySalesReport {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!/UMSATZBERICHT/i.test(normalized) || !/Flatpay/i.test(normalized)) {
    throw new Error("Das PDF ist kein unterstützter Flatpay-Umsatzbericht.");
  }

  const period = normalized.match(/Zeitraum:\s*(\d{2}\.\d{2}\.\d{2,4})\s*bis\s*(\d{2}\.\d{2}\.\d{2,4})/i);
  if (!period) throw new Error("Der Berichtszeitraum konnte nicht erkannt werden.");

  const salesSection = section(normalized, "Verkauf:", "Erstattungen:");
  const refundsSection = section(normalized, "Erstattungen:", "Gesamtumsatz:");
  const vatSection = normalized.match(/MwSt\.-Satz\s+Nettobetrag\s+MwSt\. Betrag\s+Brutto Betrag\s+(.+)$/i)?.[1] || normalized;
  const zeroRow = vatSection.match(/0,00\s*%\s+([\d.,-]+)\s+([\d.,-]+)\s+([\d.,-]+)/i);
  const standardRow = vatSection.match(/19,00\s*%\s+([\d.,-]+)\s+([\d.,-]+)\s+([\d.,-]+)/i);
  if (!zeroRow || !standardRow) {
    throw new Error("Die 0-%- oder 19-%-Steuerzeile konnte nicht vollständig gelesen werden.");
  }

  return {
    startDate: parseGermanDate(period[1]),
    endDate: parseGermanDate(period[2]),
    cashSales: labeledMoney(salesSection, "Bargeld"),
    cardSales: labeledMoney(salesSection, "Karte"),
    otherSales: labeledMoney(salesSection, "Andere"),
    cashRefunds: labeledMoney(refundsSection, "Bargeld"),
    cardRefunds: labeledMoney(refundsSection, "Karte"),
    otherRefunds: labeledMoney(refundsSection, "Andere"),
    totalSales: labeledMoney(normalized, "Gesamtumsatz"),
    tips: labeledMoney(normalized, "Trinkgelder"),
    surcharge: labeledMoney(normalized, "Surcharge"),
    zeroNet: parseGermanMoney(zeroRow[1]),
    zeroVat: parseGermanMoney(zeroRow[2]),
    zeroGross: parseGermanMoney(zeroRow[3]),
    standardNet: parseGermanMoney(standardRow[1]),
    standardVat: parseGermanMoney(standardRow[2]),
    standardGross: parseGermanMoney(standardRow[3]),
    sourceText: text,
  };
}

export function validateFlatpaySalesReport(report: FlatpaySalesReport): FlatpayValidation {
  const issues: string[] = [];
  const paymentTotal = roundMoney(
    report.cashSales + report.cardSales + report.otherSales -
      report.cashRefunds - report.cardRefunds - report.otherRefunds,
  );
  if (!close(paymentTotal, report.totalSales)) {
    issues.push(`Zahlungsarten ergeben ${money(paymentTotal)}, Gesamtumsatz ist ${money(report.totalSales)}.`);
  }
  const taxTotal = roundMoney(report.zeroGross + report.standardGross);
  if (!close(taxTotal, report.totalSales)) {
    issues.push(`Steuerzeilen ergeben ${money(taxTotal)}, Gesamtumsatz ist ${money(report.totalSales)}.`);
  }
  if (!close(report.zeroNet + report.zeroVat, report.zeroGross)) {
    issues.push("Die 0-%-Zeile ist rechnerisch nicht stimmig.");
  }
  if (!close(report.standardNet + report.standardVat, report.standardGross)) {
    issues.push("Netto plus MwSt. der 19-%-Zeile stimmt nicht mit Brutto überein.");
  }
  const expectedVat = roundMoney(report.standardNet * 0.19);
  if (!close(expectedVat, report.standardVat)) {
    issues.push(`19-%-MwSt. erwartet ${money(expectedVat)}, gelesen ${money(report.standardVat)}.`);
  }
  if (report.endDate < report.startDate) issues.push("Das Enddatum liegt vor dem Startdatum.");
  return { valid: issues.length === 0, issues };
}

export function compareFlatpayReportToLedger(
  report: FlatpaySalesReport,
  ledger: LedgerEntry[],
): FlatpayLedgerComparison {
  const entries = ledger.filter((entry) =>
    entry.date >= report.startDate &&
    entry.date <= report.endDate &&
    entry.direction === "income" &&
    isRevenueEntry(entry),
  );
  const cash = sum(entries.filter((entry) => entry.paymentMethod === "cash"));
  const card = sum(entries.filter((entry) => entry.paymentMethod === "card"));
  const other = sum(entries.filter((entry) => entry.paymentMethod === "bank" || entry.paymentMethod === "paypal"));
  const zeroEntries = entries.filter((entry) => entry.taxRate === 0);
  const standardEntries = entries.filter((entry) => entry.taxRate === 19);
  const zeroGross = sum(zeroEntries);
  const standardGross = sum(standardEntries);
  const standardVat = roundMoney(standardEntries.reduce((total, entry) => total + entry.taxAmount, 0));
  const cashZero = sum(zeroEntries.filter((entry) => entry.paymentMethod === "cash"));
  const cardZero = sum(zeroEntries.filter((entry) => entry.paymentMethod === "card"));
  const cashStandard = sum(standardEntries.filter((entry) => entry.paymentMethod === "cash"));
  const cardStandard = sum(standardEntries.filter((entry) => entry.paymentMethod === "card"));
  const total = roundMoney(cash + card + other);
  const targetCash = roundMoney(report.cashSales - report.cashRefunds);
  const targetCard = roundMoney(report.cardSales - report.cardRefunds);
  const differences = {
    cash: roundMoney(targetCash - cash),
    card: roundMoney(targetCard - card),
    total: roundMoney(report.totalSales - total),
    zeroGross: roundMoney(report.zeroGross - zeroGross),
    standardGross: roundMoney(report.standardGross - standardGross),
    standardVat: roundMoney(report.standardVat - standardVat),
  };
  return {
    cash, card, other, total, zeroGross, standardGross, standardVat,
    cashZero, cardZero, cashStandard, cardStandard,
    differences,
    exact: Object.values(differences).every((value) => Math.abs(value) <= TOLERANCE),
  };
}

export function createFlatpayImportPlan(
  current: AppState,
  report: FlatpaySalesReport,
  allocation: FlatpayTaxAllocation,
  fileName: string,
  fileDataUrl?: string,
): FlatpayImportPlan {
  const validation = validateFlatpaySalesReport(report);
  if (!validation.valid) throw new Error(validation.issues.join(" "));
  const fingerprint = flatpayFingerprint(report);
  const duplicate = current.documents.find((document) => document.metadata?.flatpayFingerprint === fingerprint);
  if (duplicate) throw new Error(`Dieser Zeitraum wurde bereits als ${duplicate.documentNumber} importiert.`);

  const comparison = compareFlatpayReportToLedger(report, current.ledger);
  const documentId = makeId("document");
  const documentNumber = `FLATPAY-${report.startDate.replaceAll("-", "")}-${report.endDate.replaceAll("-", "")}`;
  const createdAt = new Date().toISOString();
  const entries = comparison.exact
    ? []
    : createMissingEntries(report, allocation, comparison, documentId, documentNumber, createdAt, fileName, fileDataUrl);

  const document: BusinessDocument = {
    id: documentId,
    documentNumber,
    type: "zReport",
    date: report.endDate,
    amount: report.totalSales,
    taxAmount: report.standardVat,
    taxMode: "standard19",
    status: "archived",
    originalFileName: fileName,
    originalImageDataUrl: fileDataUrl,
    ocrText: report.sourceText,
    metadata: {
      provider: "Flatpay",
      reportKind: "Umsatzbericht",
      periodStart: report.startDate,
      periodEnd: report.endDate,
      cash: report.cashSales,
      card: report.cardSales,
      other: report.otherSales,
      refundsCash: report.cashRefunds,
      refundsCard: report.cardRefunds,
      refundsOther: report.otherRefunds,
      totalSales: report.totalSales,
      tips: report.tips,
      surcharge: report.surcharge,
      zeroNet: report.zeroNet,
      zeroVat: report.zeroVat,
      zeroGross: report.zeroGross,
      standardNet: report.standardNet,
      standardVat: report.standardVat,
      standardGross: report.standardGross,
      zeroCash: allocation.zeroCash,
      zeroCard: allocation.zeroCard,
      flatpayFingerprint: fingerprint,
      internallyValidated: true,
      matchedExistingLedger: comparison.exact,
      createdLedgerEntries: entries.length,
    },
    createdAt,
  };
  return { document, entries, comparison, alreadyMatched: comparison.exact };
}

export function flatpayFingerprint(report: FlatpaySalesReport): string {
  return `flatpay:${report.startDate}:${report.endDate}:${report.totalSales.toFixed(2)}:${report.standardVat.toFixed(2)}`;
}

function createMissingEntries(
  report: FlatpaySalesReport,
  allocation: FlatpayTaxAllocation,
  comparison: FlatpayLedgerComparison,
  documentId: string,
  documentNumber: string,
  createdAt: string,
  fileName: string,
  fileDataUrl?: string,
): LedgerEntry[] {
  const zeroOther = allocation.zeroOther || 0;
  if (!close(allocation.zeroCash + allocation.zeroCard + zeroOther, report.zeroGross)) {
    throw new Error(`Die Aufteilung der 0-%-Umsätze muss zusammen ${money(report.zeroGross)} ergeben.`);
  }
  const targetCash = roundMoney(report.cashSales - report.cashRefunds);
  const targetCard = roundMoney(report.cardSales - report.cardRefunds);
  const targetOther = roundMoney(report.otherSales - report.otherRefunds);
  const targets = [
    { payment: "cash" as PaymentMethod, rate: 0, amount: allocation.zeroCash, account: "8600", existing: comparison.cashZero },
    { payment: "card" as PaymentMethod, rate: 0, amount: allocation.zeroCard, account: "8600", existing: comparison.cardZero },
    { payment: "bank" as PaymentMethod, rate: 0, amount: zeroOther, account: "8600", existing: Math.max(0, comparison.zeroGross - comparison.cashZero - comparison.cardZero) },
    { payment: "cash" as PaymentMethod, rate: 19, amount: roundMoney(targetCash - allocation.zeroCash), account: "8400", existing: comparison.cashStandard },
    { payment: "card" as PaymentMethod, rate: 19, amount: roundMoney(targetCard - allocation.zeroCard), account: "8400", existing: comparison.cardStandard },
    { payment: "bank" as PaymentMethod, rate: 19, amount: roundMoney(targetOther - zeroOther), account: "8400", existing: Math.max(0, comparison.standardGross - comparison.cashStandard - comparison.cardStandard) },
  ];
  const entries: LedgerEntry[] = [];
  for (const target of targets) {
    if (target.amount < -TOLERANCE) throw new Error("Die 0-%-Aufteilung ist größer als die jeweilige Zahlungsart.");
    const missing = roundMoney(target.amount - target.existing);
    if (missing < -TOLERANCE) {
      throw new Error(`Vorhandene Buchungen für ${paymentLabel(target.payment)} / ${target.rate} % übersteigen den Flatpay-Bericht.`);
    }
    if (missing <= TOLERANCE) continue;
    const taxAmount = target.rate === 19 ? roundMoney(getTaxAmountFromGross(missing, 19)) : 0;
    entries.push({
      id: makeId("ledger"),
      date: report.endDate,
      direction: "income",
      amount: missing,
      paymentMethod: target.payment,
      description: `Flatpay Sammelbuchung ${report.startDate} bis ${report.endDate}`,
      category: `${target.account} · ${target.rate === 19 ? "Erlöse 19 Prozent" : "Steuerfreie Erlöse"}`,
      source: "flatpayImport",
      sourceId: `${flatpayFingerprint(report)}:${target.payment}:${target.rate}`,
      documentId,
      taxAmount,
      taxRate: target.rate,
      taxMode: target.rate === 19 ? "standard19" : "taxFree",
      reconciled: true,
      accountCode: target.account,
      counterAccountCode: target.payment === "cash" ? "1000" : target.payment === "card" ? "1360" : "1200",
      documentNumber,
      cashChange: target.payment === "cash" ? missing : 0,
      netAmount: roundMoney(missing - taxAmount),
      attachmentFileName: fileName,
      attachmentDataUrl: fileDataUrl,
      note: "Automatisch aus geprüftem Flatpay-Umsatzbericht ergänzt; Sammelbuchung zum Berichtsende",
      manualKind: "income",
      createdAt,
    });
  }
  return entries;
}

function isRevenueEntry(entry: LedgerEntry): boolean {
  if (entry.source === "flatpayImport") return true;
  if (entry.accountCode && REVENUE_ACCOUNTS.has(entry.accountCode)) return true;
  return /erl[oö]s|umsatz|tagesumsatz/i.test(entry.category);
}

function section(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  if (from < 0 || to < 0) return "";
  return text.slice(from + start.length, to);
}

function labeledMoney(text: string, label: string): number {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`${escaped}:?\\s*([\\d.,-]+)`, "i"));
  if (!match) throw new Error(`${label} konnte im Flatpay-Bericht nicht gelesen werden.`);
  return parseGermanMoney(match[1]);
}

function parseGermanMoney(value: string): number {
  const cleaned = value.replace(/[^0-9,.-]/g, "");
  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned;
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) throw new Error(`Ungültiger Betrag: ${value}`);
  return roundMoney(amount);
}

function parseGermanDate(value: string): string {
  const match = value.match(/(\d{2})\.(\d{2})\.(\d{2,4})/);
  if (!match) throw new Error(`Ungültiges Datum: ${value}`);
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[2]}-${match[1]}`;
}

function sum(entries: LedgerEntry[]): number {
  return roundMoney(entries.reduce((total, entry) => total + entry.amount, 0));
}

function close(left: number, right: number): boolean {
  return Math.abs(left - right) <= TOLERANCE;
}

function money(value: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value);
}

function paymentLabel(payment: PaymentMethod): string {
  return ({ cash: "Bar", card: "Karte", bank: "Andere", paypal: "PayPal" } as const)[payment];
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
