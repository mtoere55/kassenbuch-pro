import { getTaxAmountFromGross, makeId } from "./accounting";
import type { AppState, BusinessDocument, LedgerEntry, PaymentMethod } from "./types";

const TOLERANCE = 0.02;

export interface UnitelDailyLine {
  rowNumber: number;
  username: string;
  product: string;
  purchaseUnit: number;
  saleUnit: number;
  quantity: number;
  purchaseTotal: number;
  salesTotal: number;
  profit: number;
  date: string;
}

export interface UnitelDaySummary {
  date: string;
  lineCount: number;
  quantity: number;
  purchaseTotal: number;
  salesTotal: number;
  profit: number;
}

export interface UnitelMonthSummary {
  month: string;
  startDate: string;
  endDate: string;
  lineCount: number;
  dayCount: number;
  quantity: number;
  purchaseTotal: number;
  salesTotal: number;
  profit: number;
}

export interface UnitelDailyReport {
  startDate: string;
  endDate: string;
  lineCount: number;
  dayCount: number;
  quantity: number;
  purchaseTotal: number;
  salesTotal: number;
  profit: number;
  lines: UnitelDailyLine[];
  days: UnitelDaySummary[];
  months: UnitelMonthSummary[];
  sourceText: string;
}

export interface UnitelDailyValidation {
  valid: boolean;
  issues: string[];
}

export type UnitelCashAllocation = Record<string, number>;

export interface UnitelDailyImportPlan {
  document: BusinessDocument;
  entries: LedgerEntry[];
  salesEntries: number;
  commissionEntries: number;
}

export function parseUnitelDailyReport(text: string): UnitelDailyReport {
  const source = text.replace(/^\uFEFF/, "").replace(/\r/g, "");
  const rawLines = source.split("\n");
  const headerIndex = rawLines.findIndex((line) => /Benutzername/i.test(line) && /Bestelldatum/i.test(line));
  if (headerIndex < 0) {
    throw new Error("Die Kopfzeile der Pin-Sales-/UniTel-Tagesliste wurde nicht erkannt.");
  }

  const delimiter = detectDelimiter(rawLines[headerIndex]);
  const parsed: UnitelDailyLine[] = [];
  const rowIssues: string[] = [];

  for (let index = headerIndex + 1; index < rawLines.length; index += 1) {
    const raw = rawLines[index].trimEnd();
    if (!raw.trim() || /Gesamtesumme|©\s*2007\s*Pin-Sales/i.test(raw)) continue;
    const columns = splitDelimitedLine(raw, delimiter).map((value) => value.trim());
    if (columns.length < 9) continue;
    const date = parseGermanDate(columns[8]);
    if (!date) continue;

    try {
      const line: UnitelDailyLine = {
        rowNumber: index + 1,
        username: columns[0],
        product: columns[1],
        purchaseUnit: parseGermanMoney(columns[2]),
        saleUnit: parseGermanMoney(columns[3]),
        quantity: parseInteger(columns[4]),
        purchaseTotal: parseGermanMoney(columns[5]),
        salesTotal: parseGermanMoney(columns[6]),
        profit: parseGermanMoney(columns[7]),
        date,
      };
      validateLine(line, rowIssues);
      parsed.push(line);
    } catch (cause) {
      rowIssues.push(`Zeile ${index + 1}: ${cause instanceof Error ? cause.message : "unlesbare Werte"}`);
    }
  }

  if (!parsed.length) {
    throw new Error("In der Datei wurden keine lesbaren Tagesverkäufe gefunden.");
  }
  if (rowIssues.length) {
    throw new Error(rowIssues.slice(0, 5).join(" ") + (rowIssues.length > 5 ? ` Weitere ${rowIssues.length - 5} Fehler.` : ""));
  }

  const days = groupDays(parsed);
  const months = groupMonths(days);
  const report: UnitelDailyReport = {
    startDate: days[0].date,
    endDate: days[days.length - 1].date,
    lineCount: parsed.length,
    dayCount: days.length,
    quantity: parsed.reduce((sum, line) => sum + line.quantity, 0),
    purchaseTotal: roundMoney(parsed.reduce((sum, line) => sum + line.purchaseTotal, 0)),
    salesTotal: roundMoney(parsed.reduce((sum, line) => sum + line.salesTotal, 0)),
    profit: roundMoney(parsed.reduce((sum, line) => sum + line.profit, 0)),
    lines: parsed,
    days,
    months,
    sourceText: text,
  };

  const validation = validateUnitelDailyReport(report, readDeclaredTotals(source, delimiter));
  if (!validation.valid) throw new Error(validation.issues.join(" "));
  return report;
}

export function validateUnitelDailyReport(
  report: UnitelDailyReport,
  declared?: { quantity: number; purchaseTotal: number; salesTotal: number; profit: number },
): UnitelDailyValidation {
  const issues: string[] = [];
  if (report.endDate < report.startDate) issues.push("Das Enddatum liegt vor dem Startdatum.");
  if (!close(report.purchaseTotal + report.profit, report.salesTotal)) {
    issues.push("Einkaufssumme plus Gewinn stimmt nicht mit der Verkaufssumme überein.");
  }
  if (report.lineCount !== report.lines.length) issues.push("Die Anzahl der Detailzeilen ist nicht stimmig.");
  if (report.dayCount !== report.days.length) issues.push("Die Anzahl der Verkaufstage ist nicht stimmig.");
  const daySales = roundMoney(report.days.reduce((sum, day) => sum + day.salesTotal, 0));
  const dayPurchase = roundMoney(report.days.reduce((sum, day) => sum + day.purchaseTotal, 0));
  const dayProfit = roundMoney(report.days.reduce((sum, day) => sum + day.profit, 0));
  if (!close(daySales, report.salesTotal) || !close(dayPurchase, report.purchaseTotal) || !close(dayProfit, report.profit)) {
    issues.push("Die Tagessummen stimmen nicht mit der Gesamtsumme überein.");
  }
  if (declared) {
    if (declared.quantity !== report.quantity) issues.push(`Die ausgewiesene Stückzahl ${declared.quantity} stimmt nicht mit ${report.quantity} überein.`);
    if (!close(declared.purchaseTotal, report.purchaseTotal)) issues.push("Die ausgewiesene Einkaufssumme stimmt nicht mit den Detailzeilen überein.");
    if (!close(declared.salesTotal, report.salesTotal)) issues.push("Die ausgewiesene Verkaufssumme stimmt nicht mit den Detailzeilen überein.");
    if (!close(declared.profit, report.profit)) issues.push("Der ausgewiesene Gewinn stimmt nicht mit den Detailzeilen überein.");
  }
  return { valid: issues.length === 0, issues };
}

export function createUnitelDailyImportPlan(
  current: AppState,
  report: UnitelDailyReport,
  cashByDate: UnitelCashAllocation,
  fileName: string,
  fileDataUrl?: string,
): UnitelDailyImportPlan {
  const fingerprint = unitelDailyFingerprint(report);
  const duplicate = current.documents.find((document) => document.metadata?.unitelDailyFingerprint === fingerprint);
  if (duplicate) throw new Error(`Diese Tagesliste wurde bereits als ${duplicate.documentNumber} importiert.`);

  for (const day of report.days) {
    const cash = roundMoney(cashByDate[day.date]);
    if (!Number.isFinite(cash) || cash < -TOLERANCE || cash > day.salesTotal + TOLERANCE) {
      throw new Error(`Die Bar-Aufteilung für ${formatGermanDate(day.date)} ist ungültig.`);
    }
  }

  const createdAt = new Date().toISOString();
  const documentId = makeId("document");
  const documentNumber = `UNITEL-TAGE-${report.startDate.replaceAll("-", "")}-${report.endDate.replaceAll("-", "")}`;
  const entries: LedgerEntry[] = [];
  let salesEntries = 0;

  for (const day of report.days) {
    const cash = roundMoney(cashByDate[day.date]);
    const card = roundMoney(day.salesTotal - cash);
    if (cash > TOLERANCE) {
      entries.push(createSalesEntry(day, "cash", cash, fingerprint, documentId, documentNumber, createdAt, fileName, fileDataUrl));
      salesEntries += 1;
    }
    if (card > TOLERANCE) {
      entries.push(createSalesEntry(day, "card", card, fingerprint, documentId, documentNumber, createdAt, fileName, fileDataUrl));
      salesEntries += 1;
    }
  }

  for (const month of report.months) {
    const taxAmount = roundMoney(getTaxAmountFromGross(month.profit, 19));
    entries.push({
      id: makeId("ledger"),
      date: month.endDate,
      direction: "income",
      amount: month.profit,
      paymentMethod: "bank",
      description: `UniTel Vermittlungsprovision ${monthLabel(month.month)}`,
      category: "8400 · UniTel Provision 19 Prozent",
      source: "unitelImport",
      sourceId: `unitel-commission:${fingerprint}:${month.month}`,
      documentId,
      taxAmount,
      taxRate: 19,
      taxMode: "standard19",
      reconciled: true,
      accountCode: "8400",
      counterAccountCode: "1590",
      documentNumber: `UNITEL-PROV-${month.month.replace("-", "")}`,
      groupId: `unitel:${fingerprint}:${month.month}`,
      cashChange: 0,
      netAmount: roundMoney(month.profit - taxAmount),
      attachmentFileName: fileName,
      attachmentDataUrl: fileDataUrl,
      note: `Aus Tagesliste berechnet: Verkauf ${money(month.salesTotal)}, Einkauf/Abrechnung ${money(month.purchaseTotal)}.`,
      manualKind: "income",
      createdAt,
    });
  }

  const document: BusinessDocument = {
    id: documentId,
    documentNumber,
    type: "zReport",
    date: report.endDate,
    amount: report.salesTotal,
    taxAmount: roundMoney(report.months.reduce((sum, month) => sum + getTaxAmountFromGross(month.profit, 19), 0)),
    taxMode: "standard19",
    status: "archived",
    originalFileName: fileName,
    originalImageDataUrl: fileDataUrl,
    ocrText: report.sourceText,
    metadata: {
      provider: "UniTel",
      reportKind: "Pin-Sales-Tagesliste",
      periodStart: report.startDate,
      periodEnd: report.endDate,
      lineCount: report.lineCount,
      dayCount: report.dayCount,
      quantity: report.quantity,
      purchaseTotal: report.purchaseTotal,
      totalCardValue: report.salesTotal,
      commissionGross: report.profit,
      unitelDailyFingerprint: fingerprint,
      internallyValidated: true,
      createdLedgerEntries: entries.length,
      createdSalesEntries: salesEntries,
      createdCommissionEntries: report.months.length,
    },
    createdAt,
  };

  return { document, entries, salesEntries, commissionEntries: report.months.length };
}

export function unitelDailyFingerprint(report: UnitelDailyReport): string {
  return `unitel-daily:${report.startDate}:${report.endDate}:${report.quantity}:${report.salesTotal.toFixed(2)}:${report.profit.toFixed(2)}`;
}

function createSalesEntry(
  day: UnitelDaySummary,
  paymentMethod: Extract<PaymentMethod, "cash" | "card">,
  amount: number,
  fingerprint: string,
  documentId: string,
  documentNumber: string,
  createdAt: string,
  fileName: string,
  fileDataUrl?: string,
): LedgerEntry {
  const paymentAccount = paymentMethod === "cash" ? "1000" : "1360";
  return {
    id: makeId("ledger"),
    date: day.date,
    direction: "transfer",
    amount,
    paymentMethod,
    description: `UniTel Guthaben Tagesumsatz ${formatGermanDate(day.date)}`,
    category: "1590 · Durchlaufende Posten / UniTel",
    source: "unitelImport",
    sourceId: `unitel-sales:${fingerprint}:${day.date}:${paymentMethod}`,
    documentId,
    taxAmount: 0,
    taxRate: 0,
    taxMode: "taxFree",
    reconciled: true,
    accountCode: paymentAccount,
    counterAccountCode: "1590",
    documentNumber,
    groupId: `unitel:${fingerprint}:${day.date}`,
    cashChange: paymentMethod === "cash" ? amount : 0,
    netAmount: amount,
    attachmentFileName: fileName,
    attachmentDataUrl: fileDataUrl,
    note: `${day.quantity} Aufladungen · ${day.lineCount} Produktzeilen · Tagesgesamt ${money(day.salesTotal)} · davon ${paymentMethod === "cash" ? "bar" : "Karte"} ${money(amount)}`,
    manualKind: "transfer",
    createdAt,
  };
}

function validateLine(line: UnitelDailyLine, issues: string[]) {
  if (!line.product) issues.push(`Zeile ${line.rowNumber}: Kartenname fehlt.`);
  if (!Number.isInteger(line.quantity) || line.quantity <= 0) issues.push(`Zeile ${line.rowNumber}: Anzahl ist ungültig.`);
  if (line.purchaseUnit < 0 || line.saleUnit <= 0 || line.purchaseTotal < 0 || line.salesTotal <= 0 || line.profit < 0) {
    issues.push(`Zeile ${line.rowNumber}: Betrag ist ungültig.`);
  }
  if (!close(line.purchaseUnit * line.quantity, line.purchaseTotal)) {
    issues.push(`Zeile ${line.rowNumber}: Einkaufspreis × Anzahl stimmt nicht mit der Einkaufssumme überein.`);
  }
  if (!close(line.saleUnit * line.quantity, line.salesTotal)) {
    issues.push(`Zeile ${line.rowNumber}: Verkaufspreis × Anzahl stimmt nicht mit der Verkaufssumme überein.`);
  }
  if (!close(line.purchaseTotal + line.profit, line.salesTotal)) {
    issues.push(`Zeile ${line.rowNumber}: Einkaufssumme plus Gewinn stimmt nicht mit der Verkaufssumme überein.`);
  }
}

function groupDays(lines: UnitelDailyLine[]): UnitelDaySummary[] {
  const map = new Map<string, UnitelDaySummary>();
  for (const line of lines) {
    const current = map.get(line.date) || {
      date: line.date,
      lineCount: 0,
      quantity: 0,
      purchaseTotal: 0,
      salesTotal: 0,
      profit: 0,
    };
    current.lineCount += 1;
    current.quantity += line.quantity;
    current.purchaseTotal = roundMoney(current.purchaseTotal + line.purchaseTotal);
    current.salesTotal = roundMoney(current.salesTotal + line.salesTotal);
    current.profit = roundMoney(current.profit + line.profit);
    map.set(line.date, current);
  }
  return [...map.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function groupMonths(days: UnitelDaySummary[]): UnitelMonthSummary[] {
  const map = new Map<string, UnitelMonthSummary>();
  for (const day of days) {
    const month = day.date.slice(0, 7);
    const current = map.get(month) || {
      month,
      startDate: day.date,
      endDate: day.date,
      lineCount: 0,
      dayCount: 0,
      quantity: 0,
      purchaseTotal: 0,
      salesTotal: 0,
      profit: 0,
    };
    current.startDate = current.startDate < day.date ? current.startDate : day.date;
    current.endDate = current.endDate > day.date ? current.endDate : day.date;
    current.lineCount += day.lineCount;
    current.dayCount += 1;
    current.quantity += day.quantity;
    current.purchaseTotal = roundMoney(current.purchaseTotal + day.purchaseTotal);
    current.salesTotal = roundMoney(current.salesTotal + day.salesTotal);
    current.profit = roundMoney(current.profit + day.profit);
    map.set(month, current);
  }
  return [...map.values()].sort((left, right) => left.month.localeCompare(right.month));
}

function readDeclaredTotals(text: string, delimiter: string) {
  const line = text.split(/\r?\n/).find((item) => /Gesamtesumme/i.test(item));
  if (!line) return undefined;
  const columns = splitDelimitedLine(line, delimiter).map((value) => value.trim()).filter(Boolean);
  const labelIndex = columns.findIndex((value) => /Gesamtesumme/i.test(value));
  if (labelIndex < 0 || columns.length < labelIndex + 5) return undefined;
  try {
    return {
      quantity: parseInteger(columns[labelIndex + 1]),
      purchaseTotal: parseGermanMoney(columns[labelIndex + 2]),
      salesTotal: parseGermanMoney(columns[labelIndex + 3]),
      profit: parseGermanMoney(columns[labelIndex + 4]),
    };
  } catch {
    return undefined;
  }
}

function detectDelimiter(header: string): string {
  if (header.includes("\t")) return "\t";
  const semicolons = (header.match(/;/g) || []).length;
  const commas = (header.match(/,/g) || []).length;
  return semicolons >= commas ? ";" : ",";
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  if (delimiter === "\t") return line.split("\t");
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

function parseGermanMoney(value: string): number {
  const cleaned = value.replace(/[^\d,.-]/g, "");
  if (!cleaned) throw new Error("Betrag fehlt.");
  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) throw new Error(`Betrag ${value} ist ungültig.`);
  return roundMoney(parsed);
}

function parseInteger(value: string): number {
  const parsed = Number(value.replace(/[^\d-]/g, ""));
  if (!Number.isInteger(parsed)) throw new Error(`Anzahl ${value} ist ungültig.`);
  return parsed;
}

function parseGermanDate(value: string): string | undefined {
  const match = value.match(/^(\d{2})[-.](\d{2})[-.](\d{4})$/);
  if (!match) return undefined;
  const [, day, month, year] = match;
  const date = `${year}-${month}-${day}`;
  const check = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== date) return undefined;
  return date;
}

function formatGermanDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function monthLabel(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, number - 1, 1)));
}

function money(value: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value);
}

function close(left: number, right: number): boolean {
  return Math.abs(roundMoney(left - right)) <= TOLERANCE;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
