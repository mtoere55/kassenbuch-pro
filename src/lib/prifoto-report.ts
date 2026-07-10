import { getTaxAmountFromGross, makeId } from "./accounting";
import type { AppState, BusinessDocument, LedgerEntry, PaymentMethod } from "./types";

const TOLERANCE = 0.02;

export interface PrifotoDailySale {
  date: string;
  weekday: string;
  amount: number;
  orders: number;
}

export interface PrifotoProductShare {
  name: string;
  amount: number;
  sharePercent: number;
}

export interface PrifotoSalesReport {
  invoiceNumber: string;
  invoiceDate: string;
  customerNumber: string;
  periodLabel: string;
  startDate: string;
  endDate: string;
  totalSales: number;
  orderCount: number;
  dailyAverage: number;
  bestDay: string;
  bestDayAmount: number;
  days: PrifotoDailySale[];
  products: PrifotoProductShare[];
  sourceText: string;
}

export type PrifotoCashAllocation = Record<string, number>;

export interface PrifotoImportPlan {
  document: BusinessDocument;
  entries: LedgerEntry[];
  cashEntries: number;
  cardEntries: number;
}

export interface PrifotoValidation {
  valid: boolean;
  issues: string[];
}

export function parsePrifotoSalesReport(text: string): PrifotoSalesReport {
  const source = text.replace(/\u00a0/g, " ");
  const normalized = source.replace(/\s+/g, " ").trim();
  if (!/Umsatzbericht/i.test(normalized) || !/Prifoto\s+GmbH/i.test(normalized)) {
    throw new Error("Das PDF ist kein unterstützter Prifoto-Umsatzbericht.");
  }

  const periodMatch = normalized.match(/Zeitraum:\s*([A-Za-zÄÖÜäöüß]+)\s+(\d{4})/i);
  if (!periodMatch) throw new Error("Der Prifoto-Zeitraum konnte nicht erkannt werden.");
  const month = monthNumber(periodMatch[1]);
  const year = Number(periodMatch[2]);
  const periodLabel = `${periodMatch[1]} ${year}`;

  const invoiceNumber = textMatch(normalized, /Rechnungnummer:\s*([A-Z0-9-]+)/i) || textMatch(normalized, /Rechnungsnummer:\s*([A-Z0-9-]+)/i);
  const invoiceDate = parseGermanDate(textMatch(normalized, /Rechnungsdatum:\s*(\d{2}\.\d{2}\.\d{4})/i));
  const customerNumber = textMatch(normalized, /Kundennummer:\s*([A-Z0-9-]+)/i);
  if (!invoiceNumber) throw new Error("Die Prifoto-Rechnungsnummer konnte nicht gelesen werden.");
  if (!invoiceDate) throw new Error("Das Prifoto-Rechnungsdatum konnte nicht gelesen werden.");

  const headline = normalized.match(/Gesamtumsatz\s+Bestellungen\s+Tagesdurchschnitt\s+Bester\s+Tag\s+([\d.]+,\d{2})\s*€\s+(\d+)\s+([\d.]+,\d{2})\s*€\s+(.+?)\s+Datum\s+Wochentag\s+Umsatz\s+Bestellungen/i);
  if (!headline) throw new Error("Die Prifoto-Gesamtsummen konnten nicht gelesen werden.");

  const best = headline[4].match(/(.+?)\s+([\d.]+,\d{2})\s*€$/);
  const days = parseDailyRows(normalized, year, month);
  if (!days.length) throw new Error("Im Prifoto-Bericht wurden keine Tagesumsätze gefunden.");

  const report: PrifotoSalesReport = {
    invoiceNumber,
    invoiceDate,
    customerNumber,
    periodLabel,
    startDate: days[0].date,
    endDate: days[days.length - 1].date,
    totalSales: parseGermanMoney(headline[1]),
    orderCount: parseInteger(headline[2]),
    dailyAverage: parseGermanMoney(headline[3]),
    bestDay: best?.[1]?.trim() || headline[4].trim(),
    bestDayAmount: best ? parseGermanMoney(best[2]) : 0,
    days,
    products: parseProducts(normalized),
    sourceText: text,
  };

  const validation = validatePrifotoSalesReport(report);
  if (!validation.valid) throw new Error(validation.issues.join(" "));
  return report;
}

export function validatePrifotoSalesReport(report: PrifotoSalesReport): PrifotoValidation {
  const issues: string[] = [];
  if (report.endDate < report.startDate) issues.push("Das Enddatum liegt vor dem Startdatum.");
  const dailyTotal = roundMoney(report.days.reduce((sum, day) => sum + day.amount, 0));
  const dailyOrders = report.days.reduce((sum, day) => sum + day.orders, 0);
  if (!close(dailyTotal, report.totalSales)) {
    issues.push(`Tagesumsätze ergeben ${money(dailyTotal)}, Gesamtumsatz ist ${money(report.totalSales)}.`);
  }
  if (dailyOrders !== report.orderCount) {
    issues.push(`Tagesbestellungen ergeben ${dailyOrders}, ausgewiesen sind ${report.orderCount}.`);
  }
  if (report.totalSales <= 0) issues.push("Der Gesamtumsatz ist nicht gültig.");
  return { valid: issues.length === 0, issues };
}

export function createPrifotoImportPlan(
  current: AppState,
  report: PrifotoSalesReport,
  cashByDate: PrifotoCashAllocation,
  fileName: string,
  fileDataUrl?: string,
): PrifotoImportPlan {
  const validation = validatePrifotoSalesReport(report);
  if (!validation.valid) throw new Error(validation.issues.join(" "));
  const fingerprint = prifotoFingerprint(report);
  const duplicate = current.documents.find((document) => document.metadata?.prifotoFingerprint === fingerprint);
  if (duplicate) throw new Error(`Dieser Prifoto-Bericht wurde bereits als ${duplicate.documentNumber} importiert.`);

  for (const day of report.days) {
    const cash = roundMoney(cashByDate[day.date] || 0);
    if (!Number.isFinite(cash) || cash < -TOLERANCE || cash > day.amount + TOLERANCE) {
      throw new Error(`Die Bar-Aufteilung für ${formatGermanDate(day.date)} ist ungültig.`);
    }
  }

  const createdAt = new Date().toISOString();
  const documentId = makeId("document");
  const documentNumber = `PRIFOTO-${report.invoiceNumber}`;
  const entries: LedgerEntry[] = [];
  let cashEntries = 0;
  let cardEntries = 0;

  for (const day of report.days) {
    const cash = roundMoney(cashByDate[day.date] || 0);
    const card = roundMoney(day.amount - cash);
    if (cash > TOLERANCE) {
      entries.push(createSalesEntry(report, day, "cash", cash, documentId, documentNumber, createdAt, fileName, fileDataUrl));
      cashEntries += 1;
    }
    if (card > TOLERANCE) {
      entries.push(createSalesEntry(report, day, "card", card, documentId, documentNumber, createdAt, fileName, fileDataUrl));
      cardEntries += 1;
    }
  }

  const document: BusinessDocument = {
    id: documentId,
    documentNumber,
    type: "zReport",
    date: report.endDate,
    amount: report.totalSales,
    taxAmount: roundMoney(getTaxAmountFromGross(report.totalSales, 19)),
    taxMode: "standard19",
    status: "archived",
    originalFileName: fileName,
    originalImageDataUrl: fileDataUrl,
    ocrText: report.sourceText,
    metadata: {
      provider: "Prifoto",
      reportKind: "Tagesverkäufe",
      invoiceNumber: report.invoiceNumber,
      invoiceDate: report.invoiceDate,
      customerNumber: report.customerNumber,
      periodLabel: report.periodLabel,
      periodStart: report.startDate,
      periodEnd: report.endDate,
      totalSales: report.totalSales,
      orderCount: report.orderCount,
      dayCount: report.days.length,
      dailyAverage: report.dailyAverage,
      bestDay: report.bestDay,
      bestDayAmount: report.bestDayAmount,
      prifotoFingerprint: fingerprint,
      internallyValidated: true,
      createdLedgerEntries: entries.length,
      cashEntries,
      cardEntries,
    },
    createdAt,
  };

  return { document, entries, cashEntries, cardEntries };
}

export function prifotoFingerprint(report: PrifotoSalesReport): string {
  return `prifoto:${report.invoiceNumber}:${report.invoiceDate}:${report.totalSales.toFixed(2)}:${report.orderCount}`;
}

function createSalesEntry(
  report: PrifotoSalesReport,
  day: PrifotoDailySale,
  paymentMethod: Extract<PaymentMethod, "cash" | "card">,
  amount: number,
  documentId: string,
  documentNumber: string,
  createdAt: string,
  fileName: string,
  fileDataUrl?: string,
): LedgerEntry {
  const taxAmount = roundMoney(getTaxAmountFromGross(amount, 19));
  return {
    id: makeId("ledger"),
    date: day.date,
    direction: "income",
    amount,
    paymentMethod,
    description: `Prifoto Tagesverkäufe ${formatGermanDate(day.date)}`,
    category: "8400 · Erlöse 19 Prozent / Prifoto",
    source: "prifotoImport",
    sourceId: `${prifotoFingerprint(report)}:${day.date}:${paymentMethod}`,
    documentId,
    taxAmount,
    taxRate: 19,
    taxMode: "standard19",
    reconciled: true,
    accountCode: "8400",
    counterAccountCode: paymentMethod === "cash" ? "1000" : "1360",
    documentNumber,
    groupId: `prifoto:${prifotoFingerprint(report)}:${day.date}`,
    cashChange: paymentMethod === "cash" ? amount : 0,
    netAmount: roundMoney(amount - taxAmount),
    attachmentFileName: fileName,
    attachmentDataUrl: fileDataUrl,
    note: `${day.weekday} · ${day.orders} Bestellung(en) · Tagesgesamt ${money(day.amount)} · davon ${paymentMethod === "cash" ? "bar" : "Karte"} ${money(amount)}`,
    manualKind: "income",
    createdAt,
  };
}

function parseDailyRows(text: string, year: number, month: number): PrifotoDailySale[] {
  const weekday = "Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag";
  const pattern = new RegExp(`(\\d{2}\\.\\d{2}\\.)\\s+(${weekday})\\s+([\\d.]+,\\d{2})\\s*€\\s+(\\d+)`, "gi");
  const rows: PrifotoDailySale[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const date = parseDayMonth(match[1], year);
    if (Number(date.slice(5, 7)) !== month) continue;
    const key = `${date}:${match[3]}:${match[4]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      date,
      weekday: match[2],
      amount: parseGermanMoney(match[3]),
      orders: parseInteger(match[4]),
    });
  }
  return rows.sort((left, right) => left.date.localeCompare(right.date));
}

function parseProducts(text: string): PrifotoProductShare[] {
  const products: PrifotoProductShare[] = [];
  const sectionMatch = text.match(/Produktanteile\s+(.+?)\s+Seite\s+2/i);
  const haystack = sectionMatch?.[1] || "";
  const pattern = /([A-Za-z0-9_ äöüÄÖÜß-]+?)\s+([\d.]+,\d{2})\s*€\s*\((\d+[,.]?\d*)%\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(haystack))) {
    products.push({
      name: match[1].trim(),
      amount: parseGermanMoney(match[2]),
      sharePercent: Number(match[3].replace(",", ".")),
    });
  }
  return products;
}

function textMatch(text: string, pattern: RegExp): string {
  return text.match(pattern)?.[1]?.trim() || "";
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

function parseInteger(value: string): number {
  const parsed = Number(value.replace(/[^0-9-]/g, ""));
  if (!Number.isInteger(parsed)) throw new Error(`Ungültige Anzahl: ${value}`);
  return parsed;
}

function parseGermanDate(value: string): string {
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return "";
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function parseDayMonth(value: string, year: number): string {
  const match = value.match(/^(\d{2})\.(\d{2})\.$/);
  if (!match) throw new Error(`Ungültiges Datum: ${value}`);
  return `${year}-${match[2]}-${match[1]}`;
}

function monthNumber(name: string): number {
  const normalized = name.toLowerCase();
  const months: Record<string, number> = {
    januar: 1,
    februar: 2,
    märz: 3,
    maerz: 3,
    april: 4,
    mai: 5,
    juni: 6,
    juli: 7,
    august: 8,
    september: 9,
    oktober: 10,
    november: 11,
    dezember: 12,
  };
  const month = months[normalized];
  if (!month) throw new Error(`Unbekannter Monat: ${name}`);
  return month;
}

function formatGermanDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function close(left: number, right: number): boolean {
  return Math.abs(roundMoney(left - right)) <= TOLERANCE;
}

function money(value: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
