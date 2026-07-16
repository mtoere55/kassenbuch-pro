import { getTaxAmountFromGross, makeId } from "./accounting";
import { createPeriodBookingNumberAllocator } from "./business-booking-rules";
import type { AppState, BusinessDocument, LedgerEntry } from "./types";

const TOLERANCE = 0.02;

export interface PrifotoDailySale {
  date: string;
  amount: number;
  orders: number;
}

export interface PrifotoCashReport {
  invoiceNumber: string;
  invoiceDate: string;
  periodMonth: string;
  periodStart: string;
  periodEnd: string;
  total: number;
  orderCount: number;
  salesDayCount: number;
  days: PrifotoDailySale[];
  productTotal?: number;
  productDifference?: number;
  sourceText: string;
  fingerprint: string;
}

export interface PrifotoCashConflict {
  date: string;
  reportTotal: number;
  existingTotal: number;
  difference: number;
}

export interface PrifotoCashImportPlan {
  document: BusinessDocument;
  entries: LedgerEntry[];
  importedDays: number;
  skippedExistingDays: number;
  conflicts: PrifotoCashConflict[];
  totalCash: number;
  partnerShare: number;
  ownShare: number;
  ownVat: number;
}

export function parsePrifotoCashReport(text: string): PrifotoCashReport {
  const source = normalizeText(text);
  if (!/Prifoto GmbH/i.test(source) || !/Umsatzbericht/i.test(source)) {
    throw new Error("Die Datei wurde nicht als Prifoto-Umsatzbericht erkannt.");
  }

  const invoiceNumber = requiredMatch(source, /Rechnungnummer:\s*(RE-[A-Z0-9-]+)/i, "Rechnungsnummer");
  const invoiceDate = parseGermanDate(requiredMatch(source, /Rechnungsdatum:\s*(\d{2}\.\d{2}\.\d{4})/i, "Rechnungsdatum"));
  const periodLabel = requiredMatch(source, /Zeitraum:\s*([A-Za-zÄÖÜäöüß]+)\s+(\d{4})/i, "Zeitraum", 1);
  const periodYear = Number(requiredMatch(source, /Zeitraum:\s*[A-Za-zÄÖÜäöüß]+\s+(\d{4})/i, "Zeitraum", 1));
  const month = germanMonthNumber(periodLabel);
  const periodMonth = `${periodYear}-${String(month).padStart(2, "0")}`;
  const periodStart = `${periodMonth}-01`;
  const lastDay = new Date(Date.UTC(periodYear, month, 0)).getUTCDate();
  const periodEnd = `${periodMonth}-${String(lastDay).padStart(2, "0")}`;

  const summary = source.match(/(?:^|\n)\s*Gesamt\s+(\d+)\s+Tage\s+mit\s+Umsatz\s+([\d.]+,\d{2})\s*€\s+(\d+)\s*(?:\n|$)/i);
  if (!summary) throw new Error("Die Prifoto-Gesamtsumme wurde nicht erkannt.");
  const salesDayCount = Number(summary[1]);
  const total = parseGermanMoney(summary[2]);
  const orderCount = Number(summary[3]);

  const days: PrifotoDailySale[] = [];
  const dayPattern = /(?:^|\n)\s*(\d{2}\.\d{2}\.)\s+[A-Za-zÄÖÜäöüß]+\s+([\d.]+,\d{2})\s*€\s+(\d+)\s*(?=\n|$)/g;
  for (const match of source.matchAll(dayPattern)) {
    const [day, monthPart] = match[1].split(".").filter(Boolean).map(Number);
    const date = `${periodYear}-${String(monthPart).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!isValidIsoDate(date) || !date.startsWith(`${periodMonth}-`)) {
      throw new Error(`Ungültiges Verkaufsdatum ${match[1]} im Prifoto-Bericht.`);
    }
    days.push({ date, amount: parseGermanMoney(match[2]), orders: Number(match[3]) });
  }

  if (!days.length) throw new Error("Im Prifoto-Bericht wurden keine Tagesverkäufe erkannt.");
  const dailyTotal = roundMoney(days.reduce((sum, day) => sum + day.amount, 0));
  const dailyOrders = days.reduce((sum, day) => sum + day.orders, 0);
  if (!close(dailyTotal, total)) {
    throw new Error(`Die Prifoto-Tagessummen ${money(dailyTotal)} stimmen nicht mit der Gesamtsumme ${money(total)} überein.`);
  }
  if (dailyOrders !== orderCount) {
    throw new Error(`Die Prifoto-Bestellungen ${dailyOrders} stimmen nicht mit der ausgewiesenen Anzahl ${orderCount} überein.`);
  }
  if (days.length !== salesDayCount) {
    throw new Error(`Es wurden ${days.length} Verkaufstage gelesen, im Bericht stehen ${salesDayCount}.`);
  }

  const headerTotalMatch = source.match(/Gesamtumsatz[\s\S]{0,260}?([\d.]+,\d{2})\s*€/i);
  if (headerTotalMatch && !close(parseGermanMoney(headerTotalMatch[1]), total)) {
    throw new Error("Die Prifoto-Gesamtumsätze auf Seite 1 und Seite 2 stimmen nicht überein.");
  }

  const productTotal = readProductTotal(source);
  const productDifference = productTotal === undefined ? undefined : roundMoney(productTotal - total);
  const fingerprint = `prifoto:${invoiceNumber}:${periodMonth}:${total.toFixed(2)}:${orderCount}`;

  return {
    invoiceNumber,
    invoiceDate,
    periodMonth,
    periodStart,
    periodEnd,
    total,
    orderCount,
    salesDayCount,
    days,
    productTotal,
    productDifference,
    sourceText: text,
    fingerprint,
  };
}

export function createPrifotoCashImportPlan(
  current: AppState,
  report: PrifotoCashReport,
  fileName: string,
  fileDataUrl?: string,
): PrifotoCashImportPlan {
  const duplicate = current.documents.find((document) =>
    document.metadata?.prifotoFingerprint === report.fingerprint ||
    (document.metadata?.provider === "Prifoto" && document.documentNumber === report.invoiceNumber),
  );
  if (duplicate) throw new Error(`Dieser Prifoto-Bericht wurde bereits als ${duplicate.documentNumber} importiert.`);

  const existingByDate = existingPrifotoCashByDate(current.ledger);
  const skippedDates = new Set<string>();
  const conflicts: PrifotoCashConflict[] = [];
  for (const day of report.days) {
    const existingTotal = roundMoney(existingByDate.get(day.date) || 0);
    if (existingTotal <= TOLERANCE) continue;
    if (close(existingTotal, day.amount)) {
      skippedDates.add(day.date);
      continue;
    }
    conflicts.push({
      date: day.date,
      reportTotal: day.amount,
      existingTotal,
      difference: roundMoney(day.amount - existingTotal),
    });
  }

  const documentId = makeId("document");
  const createdAt = new Date().toISOString();
  const allocateCashNumber = createPeriodBookingNumberAllocator("KASSE", current.ledger);
  const entries: LedgerEntry[] = [];

  for (const day of report.days) {
    if (skippedDates.has(day.date) || conflicts.some((conflict) => conflict.date === day.date)) continue;
    const bookingNumber = allocateCashNumber(day.date);
    const partnerShare = roundMoney(day.amount / 2);
    const ownShare = roundMoney(day.amount - partnerShare);
    const groupId = `${report.fingerprint}:${day.date}`;
    const sharedNote = `${report.invoiceNumber} · ${day.orders} Bestellung(en) · Prifoto-Tagesverkauf vollständig bar · 50/50-Aufteilung.`;

    entries.push({
      id: makeId("ledger"),
      date: day.date,
      direction: "transfer",
      amount: partnerShare,
      paymentMethod: "cash",
      description: "Prifoto Fremdanteil / Verrechnung",
      category: "1592 · Durchlaufende Posten / Prifoto",
      source: "prifotoImport",
      sourceId: `prifoto-sales:${report.fingerprint}:${day.date}:partner`,
      documentId,
      taxAmount: 0,
      taxRate: 0,
      taxMode: "taxFree",
      reconciled: true,
      accountCode: "1592",
      counterAccountCode: "1000",
      documentNumber: bookingNumber,
      groupId,
      cashChange: partnerShare,
      netAmount: partnerShare,
      attachmentFileName: fileName,
      attachmentDataUrl: fileDataUrl,
      note: sharedNote,
      manualKind: "transfer",
      createdAt,
    });

    const ownVat = getTaxAmountFromGross(ownShare, 19);
    entries.push({
      id: makeId("ledger"),
      date: day.date,
      direction: "income",
      amount: ownShare,
      paymentMethod: "cash",
      description: "Prifoto Eigenanteil / Provision",
      category: "8401 · Erlöse 19 Prozent / Prifoto Eigenanteil",
      source: "prifotoImport",
      sourceId: `prifoto-sales:${report.fingerprint}:${day.date}:own`,
      documentId,
      taxAmount: ownVat,
      taxRate: 19,
      taxMode: "standard19",
      reconciled: true,
      accountCode: "8401",
      counterAccountCode: "1000",
      documentNumber: bookingNumber,
      groupId,
      cashChange: ownShare,
      netAmount: roundMoney(ownShare - ownVat),
      attachmentFileName: fileName,
      attachmentDataUrl: fileDataUrl,
      note: sharedNote,
      manualKind: "income",
      createdAt,
    });
  }

  const ownShare = roundMoney(report.total / 2);
  const partnerShare = roundMoney(report.total - ownShare);
  const ownVat = getTaxAmountFromGross(ownShare, 19);
  const document: BusinessDocument = {
    id: documentId,
    documentNumber: report.invoiceNumber,
    type: "zReport",
    date: report.invoiceDate,
    amount: report.total,
    taxAmount: ownVat,
    taxMode: "standard19",
    paymentMethod: "cash",
    status: "archived",
    originalFileName: fileName,
    originalImageDataUrl: fileDataUrl,
    ocrText: report.sourceText,
    metadata: {
      provider: "Prifoto",
      reportKind: "Tagesverkäufe 50/50",
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      salesDayCount: report.salesDayCount,
      orderCount: report.orderCount,
      totalCash: report.total,
      partnerShare,
      ownShare,
      ownVat,
      productTotal: report.productTotal ?? null,
      productDifference: report.productDifference ?? null,
      paymentAllocation: "all-cash-confirmed",
      prifotoFingerprint: report.fingerprint,
      importedDays: report.days.length - skippedDates.size - conflicts.length,
      skippedExistingDays: skippedDates.size,
      conflictDays: conflicts.length,
      internallyValidated: true,
    },
    createdAt,
  };

  return {
    document,
    entries,
    importedDays: report.days.length - skippedDates.size - conflicts.length,
    skippedExistingDays: skippedDates.size,
    conflicts,
    totalCash: report.total,
    partnerShare,
    ownShare,
    ownVat,
  };
}

function existingPrifotoCashByDate(entries: LedgerEntry[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const entry of entries) {
    if (entry.paymentMethod !== "cash" || (entry.cashChange || 0) <= TOLERANCE) continue;
    const text = `${entry.description} ${entry.category} ${entry.note || ""}`.toLowerCase();
    if (entry.source !== "prifotoImport" && !text.includes("prifoto")) continue;
    result.set(entry.date, roundMoney((result.get(entry.date) || 0) + (entry.cashChange || 0)));
  }
  return result;
}

function readProductTotal(source: string): number | undefined {
  const marker = source.search(/Produktanteile/i);
  if (marker < 0) return undefined;
  const section = source.slice(marker);
  const values = [...section.matchAll(/([\d.]+,\d{2})\s*€\s*\(\s*[\d.,]+\s*%\s*\)/g)]
    .map((match) => parseGermanMoney(match[1]));
  if (!values.length) return undefined;
  return roundMoney(values.reduce((sum, value) => sum + value, 0));
}

function requiredMatch(source: string, pattern: RegExp, label: string, group = 1): string {
  const match = source.match(pattern);
  const value = match?.[group]?.trim();
  if (!value) throw new Error(`${label} wurde im Prifoto-Bericht nicht erkannt.`);
  return value;
}

function germanMonthNumber(value: string): number {
  const normalized = value.toLowerCase().replaceAll("ä", "a").replaceAll("ö", "o").replaceAll("ü", "u");
  const months: Record<string, number> = {
    januar: 1, februar: 2, marz: 3, april: 4, mai: 5, juni: 6,
    juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12,
  };
  const month = months[normalized];
  if (!month) throw new Error(`Unbekannter Prifoto-Monat ${value}.`);
  return month;
}

function normalizeText(value: string): string {
  return value.replace(/\r/g, "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
}

function parseGermanMoney(value: string): number {
  const parsed = Number(value.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(parsed)) throw new Error(`Ungültiger Betrag ${value}.`);
  return roundMoney(parsed);
}

function parseGermanDate(value: string): string {
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) throw new Error(`Ungültiges Datum ${value}.`);
  const date = `${match[3]}-${match[2]}-${match[1]}`;
  if (!isValidIsoDate(date)) throw new Error(`Ungültiges Datum ${value}.`);
  return date;
}

function isValidIsoDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function close(left: number, right: number): boolean {
  return Math.abs(roundMoney(left - right)) <= TOLERANCE;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function money(value: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value);
}
