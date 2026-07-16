import { makeId } from "./accounting";
import type { AppState, BusinessDocument, LedgerEntry, PaymentMethod } from "./types";

const TOLERANCE = 0.02;
const REQUIRED_FILES = [
  "cashpointclosing.csv",
  "payment.csv",
  "businesscases.csv",
  "transactions.csv",
  "transactions_vat.csv",
  "datapayment.csv",
  "vat.csv",
];

type CsvRow = Record<string, string>;

export interface DsfinvkAllocation {
  paymentMethod: PaymentMethod;
  taxRate: 0 | 7 | 19;
  accountCode: string;
  label: string;
  gross: number;
  net: number;
  tax: number;
}

export interface DsfinvkClosing {
  fingerprint: string;
  cashRegisterId: string;
  zNumber: string;
  date: string;
  createdAt: string;
  businessName: string;
  totalPayments: number;
  cashPayments: number;
  cardPayments: number;
  otherPayments: number;
  gross19: number;
  net19: number;
  vat19: number;
  gross7: number;
  vat7: number;
  gross0: number;
  surcharge: number;
  tips: number;
  receiptCount: number;
  allocations: DsfinvkAllocation[];
}

export interface DsfinvkExport {
  closings: DsfinvkClosing[];
  startDate: string;
  endDate: string;
  totalPayments: number;
  totalCash: number;
  totalCard: number;
  totalVat: number;
  receiptCount: number;
  sourceFiles: number;
}

export interface DsfinvkImportPlan {
  documents: BusinessDocument[];
  entries: LedgerEntry[];
  closingCount: number;
  bookedClosings: number;
  archiveOnlyClosings: number;
  duplicateClosings: number;
  duplicateEntries: number;
  cutoverDate: string;
}

export function parseDsfinvkExport(files: Map<string, string>): DsfinvkExport {
  for (const name of REQUIRED_FILES) {
    if (!files.has(name)) throw new Error(`Im Flatpay-ZIP fehlt ${name}.`);
  }

  const closings = parseTable(files, "cashpointclosing.csv");
  const payments = parseTable(files, "payment.csv");
  const businessCases = parseTable(files, "businesscases.csv");
  const transactions = parseTable(files, "transactions.csv");
  const transactionVat = parseTable(files, "transactions_vat.csv");
  const dataPayments = parseTable(files, "datapayment.csv");
  const vatRows = parseTable(files, "vat.csv");
  if (!closings.length) throw new Error("Im Flatpay-ZIP wurden keine Kassenabschlüsse gefunden.");

  const paymentByClosing = groupBy(payments, closingKey);
  const businessByClosing = groupBy(businessCases, closingKey);
  const transactionByClosing = groupBy(transactions, closingKey);
  const vatByReceipt = groupBy(transactionVat, receiptKey);
  const paymentByReceipt = groupBy(dataPayments, receiptKey);
  const vatRateMap = new Map<string, 0 | 7 | 19>();
  for (const row of vatRows) {
    vatRateMap.set(`${closingKey(row)}|${row.UST_SCHLUESSEL}`, normalizeTaxRate(number(row.UST_SATZ)));
  }

  const parsed = closings.map((closing) => {
    const key = closingKey(closing);
    const totalPayments = money(closing.Z_SE_ZAHLUNGEN);
    const expectedCash = money(closing.Z_SE_BARZAHLUNGEN);
    const closingPayments = paymentByClosing.get(key) || [];
    const cashPayments = roundMoney(sumWhere(closingPayments, (row) => paymentMethod(row.ZAHLART_TYP) === "cash", "Z_ZAHLART_BETRAG"));
    const cardPayments = roundMoney(sumWhere(closingPayments, (row) => paymentMethod(row.ZAHLART_TYP) === "card", "Z_ZAHLART_BETRAG"));
    const otherPayments = roundMoney(sumWhere(closingPayments, (row) => !["cash", "card"].includes(paymentMethod(row.ZAHLART_TYP)), "Z_ZAHLART_BETRAG"));
    assertClose(cashPayments, expectedCash, `Barzahlung im Z-Abschluss ${closing.Z_NR}`);
    assertClose(cashPayments + cardPayments + otherPayments, totalPayments, `Zahlungsarten im Z-Abschluss ${closing.Z_NR}`);

    const allocationMap = new Map<string, DsfinvkAllocation>();
    const receiptRows = transactionByClosing.get(key) || [];
    let receiptTotal = 0;
    for (const receipt of receiptRows) {
      const gross = money(receipt.UMS_BRUTTO);
      receiptTotal = roundMoney(receiptTotal + gross);
      const receiptVatRows = vatByReceipt.get(receiptKey(receipt)) || [];
      const receiptPaymentRows = (paymentByReceipt.get(receiptKey(receipt)) || [])
        .map((row) => ({ method: paymentMethod(row.ZAHLART_TYP), amount: money(row.BASISWAEH_BETRAG) }))
        .filter((row) => Math.abs(row.amount) > 0.004);
      const paymentTotal = roundMoney(receiptPaymentRows.reduce((sum, row) => sum + row.amount, 0));
      assertClose(paymentTotal, gross, `Zahlungssumme für Bon ${receipt.BON_NR || receipt.BON_ID}`);
      if (!receiptPaymentRows.length && Math.abs(gross) > TOLERANCE) {
        throw new Error(`Für Bon ${receipt.BON_NR || receipt.BON_ID} wurde keine Zahlungsart gefunden.`);
      }

      const vatParts = receiptVatRows.map((row) => ({
        rate: vatRateMap.get(`${key}|${row.UST_SCHLUESSEL}`) ?? normalizeTaxKey(row.UST_SCHLUESSEL),
        gross: money(row.BON_BRUTTO),
        net: money(row.BON_NETTO),
        tax: money(row.BON_UST),
      }));
      const vatGross = roundMoney(vatParts.reduce((sum, row) => sum + row.gross, 0));
      const surcharge = roundMoney(gross - vatGross);

      for (const pay of receiptPaymentRows) {
        const ratio = paymentTotal ? pay.amount / paymentTotal : 0;
        for (const vatPart of vatParts) {
          addAllocation(allocationMap, {
            paymentMethod: pay.method,
            taxRate: vatPart.rate,
            accountCode: revenueAccount(vatPart.rate),
            label: vatPart.rate === 19 ? "Flatpay Erlöse 19 Prozent" : vatPart.rate === 7 ? "Flatpay Erlöse 7 Prozent" : "Flatpay steuerfreie Erlöse",
            gross: vatPart.gross * ratio,
            net: vatPart.net * ratio,
            tax: vatPart.tax * ratio,
          });
        }
        if (Math.abs(surcharge) > 0.004) {
          addAllocation(allocationMap, {
            paymentMethod: pay.method,
            taxRate: 0,
            accountCode: "2740",
            label: "Flatpay Aufschlag / sonstiger Ertrag",
            gross: surcharge * ratio,
            net: surcharge * ratio,
            tax: 0,
          });
        }
      }
    }
    assertClose(receiptTotal, totalPayments, `Bon-Summe im Z-Abschluss ${closing.Z_NR}`);

    const allocations = [...allocationMap.values()]
      .map((item) => ({ ...item, gross: roundMoney(item.gross), net: roundMoney(item.net), tax: roundMoney(item.tax) }))
      .filter((item) => Math.abs(item.gross) > 0.004)
      .sort((left, right) => `${left.paymentMethod}|${left.taxRate}|${left.accountCode}`.localeCompare(`${right.paymentMethod}|${right.taxRate}|${right.accountCode}`));
    assertClose(allocations.reduce((sum, item) => sum + item.gross, 0), totalPayments, `Buchungsmatrix im Z-Abschluss ${closing.Z_NR}`);

    const closingBusiness = businessByClosing.get(key) || [];
    const tips = roundMoney(sumBusiness(closingBusiness, ["TrinkgeldAN", "TrinkgeldAG"]));
    const surcharge = roundMoney(sumBusiness(closingBusiness, ["Aufschlag"]));
    const gross19 = roundMoney(sumRate(allocations, 19, "gross"));
    const net19 = roundMoney(sumRate(allocations, 19, "net"));
    const vat19 = roundMoney(sumRate(allocations, 19, "tax"));
    const gross7 = roundMoney(sumRate(allocations, 7, "gross"));
    const vat7 = roundMoney(sumRate(allocations, 7, "tax"));
    const gross0 = roundMoney(sumRate(allocations.filter((item) => item.accountCode !== "2740"), 0, "gross"));
    const date = closing.Z_BUCHUNGSTAG || closing.Z_ERSTELLUNG.slice(0, 10);
    const fingerprint = `dsfinvk:${closing.Z_KASSE_ID}:${closing.Z_NR}:${closing.Z_ERSTELLUNG}:${totalPayments.toFixed(2)}`;

    return {
      fingerprint,
      cashRegisterId: closing.Z_KASSE_ID,
      zNumber: closing.Z_NR,
      date,
      createdAt: closing.Z_ERSTELLUNG,
      businessName: closing.NAME || "Flatpay Kasse",
      totalPayments,
      cashPayments,
      cardPayments,
      otherPayments,
      gross19,
      net19,
      vat19,
      gross7,
      vat7,
      gross0,
      surcharge,
      tips,
      receiptCount: receiptRows.length,
      allocations,
    } satisfies DsfinvkClosing;
  }).sort((left, right) => `${left.date}|${left.zNumber}`.localeCompare(`${right.date}|${right.zNumber}`));

  const dates = parsed.map((closing) => closing.date);
  return {
    closings: parsed,
    startDate: dates[0],
    endDate: dates.at(-1) || dates[0],
    totalPayments: roundMoney(parsed.reduce((sum, closing) => sum + closing.totalPayments, 0)),
    totalCash: roundMoney(parsed.reduce((sum, closing) => sum + closing.cashPayments, 0)),
    totalCard: roundMoney(parsed.reduce((sum, closing) => sum + closing.cardPayments, 0)),
    totalVat: roundMoney(parsed.reduce((sum, closing) => sum + closing.vat19 + closing.vat7, 0)),
    receiptCount: parsed.reduce((sum, closing) => sum + closing.receiptCount, 0),
    sourceFiles: files.size,
  };
}

export function suggestDsfinvkCutoverDate(current: AppState, report: DsfinvkExport): string {
  const latestKasDate = current.ledger
    .filter((entry) => entry.source === "kasImport")
    .map((entry) => entry.date)
    .sort()
    .at(-1);
  if (!latestKasDate) return report.startDate;
  const next = addDays(latestKasDate, 1);
  return next > report.startDate ? next : report.startDate;
}

export function createDsfinvkImportPlan(
  current: AppState,
  report: DsfinvkExport,
  fileName: string,
  cutoverDate: string,
  fileDataUrl?: string,
): DsfinvkImportPlan {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoverDate)) throw new Error("Bitte ein gültiges Startdatum wählen.");
  const existingFingerprints = new Map(
    current.documents
      .filter((document) => typeof document.metadata?.dsfinvkFingerprint === "string")
      .map((document) => [String(document.metadata?.dsfinvkFingerprint), document]),
  );
  const existingSourceIds = new Set(current.ledger.map((entry) => entry.sourceId).filter(Boolean));
  const documents: BusinessDocument[] = [];
  const entries: LedgerEntry[] = [];
  let duplicateClosings = 0;
  let duplicateEntries = 0;
  let bookedClosings = 0;
  let archiveOnlyClosings = 0;

  const archiveFingerprint = `dsfinvk-archive:${report.startDate}:${report.endDate}:${report.closings.length}:${report.totalPayments.toFixed(2)}`;
  const archiveExists = current.documents.some((document) => document.metadata?.dsfinvkArchiveFingerprint === archiveFingerprint);
  if (!archiveExists) {
    documents.push({
      id: makeId("document"),
      documentNumber: `FLATPAY-DSFINVK-${report.startDate.replaceAll("-", "")}-${report.endDate.replaceAll("-", "")}`,
      type: "zReport",
      date: report.endDate,
      amount: report.totalPayments,
      taxAmount: report.totalVat,
      taxMode: report.totalVat ? "standard19" : "taxFree",
      status: "archived",
      originalFileName: fileName,
      originalImageDataUrl: fileDataUrl,
      metadata: {
        provider: "Flatpay",
        reportKind: "DSFinV-K Periodenexport",
        periodStart: report.startDate,
        periodEnd: report.endDate,
        closingCount: report.closings.length,
        receiptCount: report.receiptCount,
        totalPayments: report.totalPayments,
        totalCash: report.totalCash,
        totalCard: report.totalCard,
        totalVat: report.totalVat,
        dsfinvkArchiveFingerprint: archiveFingerprint,
        internallyValidated: true,
      },
      createdAt: new Date().toISOString(),
    });
  }

  for (const closing of report.closings) {
    let document = existingFingerprints.get(closing.fingerprint);
    if (document) duplicateClosings += 1;
    else {
      document = closingDocument(closing, fileName, cutoverDate);
      documents.push(document);
    }

    if (closing.date < cutoverDate) {
      archiveOnlyClosings += 1;
      continue;
    }
    bookedClosings += 1;

    for (const allocation of closing.allocations) {
      const sourceId = `${closing.fingerprint}:${allocation.paymentMethod}:${allocation.taxRate}:${allocation.accountCode}`;
      if (existingSourceIds.has(sourceId)) {
        duplicateEntries += 1;
        continue;
      }
      entries.push(allocationEntry(closing, allocation, document, sourceId, fileName));
      existingSourceIds.add(sourceId);
    }
  }

  return {
    documents,
    entries,
    closingCount: report.closings.length,
    bookedClosings,
    archiveOnlyClosings,
    duplicateClosings,
    duplicateEntries,
    cutoverDate,
  };
}

function closingDocument(closing: DsfinvkClosing, fileName: string, cutoverDate: string): BusinessDocument {
  return {
    id: makeId("document"),
    documentNumber: `Z-FLATPAY-${closing.date.replaceAll("-", "")}-${closing.zNumber}`,
    type: "zReport",
    date: closing.date,
    amount: closing.totalPayments,
    taxAmount: roundMoney(closing.vat19 + closing.vat7),
    taxMode: closing.vat19 || closing.vat7 ? "standard19" : "taxFree",
    status: "archived",
    originalFileName: fileName,
    metadata: {
      provider: "Flatpay",
      reportKind: "DSFinV-K Tagesabschluss",
      zNumber: closing.zNumber,
      cashRegisterId: closing.cashRegisterId,
      totalPayments: closing.totalPayments,
      cashPayments: closing.cashPayments,
      cardPayments: closing.cardPayments,
      otherPayments: closing.otherPayments,
      gross19: closing.gross19,
      vat19: closing.vat19,
      gross0: closing.gross0,
      surcharge: closing.surcharge,
      receiptCount: closing.receiptCount,
      dsfinvkFingerprint: closing.fingerprint,
      automaticallyBooked: closing.date >= cutoverDate,
      internallyValidated: true,
    },
    createdAt: closing.createdAt,
  };
}

function allocationEntry(
  closing: DsfinvkClosing,
  allocation: DsfinvkAllocation,
  document: BusinessDocument,
  sourceId: string,
  fileName: string,
): LedgerEntry {
  return {
    id: makeId("ledger"),
    date: closing.date,
    direction: "income",
    amount: allocation.gross,
    paymentMethod: allocation.paymentMethod,
    description: `${allocation.label} · Z ${closing.zNumber}`,
    category: `${allocation.accountCode} · ${allocation.label}`,
    source: "flatpayImport",
    sourceId,
    documentId: document.id,
    taxAmount: allocation.tax,
    taxRate: allocation.taxRate,
    taxMode: allocation.taxRate ? "standard19" : "taxFree",
    reconciled: true,
    accountCode: allocation.accountCode,
    counterAccountCode: paymentCounterAccount(allocation.paymentMethod),
    documentNumber: document.documentNumber,
    groupId: closing.fingerprint,
    cashChange: allocation.paymentMethod === "cash" ? allocation.gross : 0,
    netAmount: allocation.net,
    attachmentFileName: fileName,
    note: `Flatpay DSFinV-K Tagesabschluss Z ${closing.zNumber}; ${closing.receiptCount} Beleg(e); geprüft aus ${fileName}.`,
    manualKind: "income",
    createdAt: closing.createdAt,
  };
}

function parseTable(files: Map<string, string>, name: string): CsvRow[] {
  return parseDelimited(files.get(name) || "");
}

function parseDelimited(text: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ";") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  const header = rows.shift()?.map((value) => value.replace(/^\uFEFF/, "")) || [];
  return rows.filter((values) => values.some(Boolean)).map((values) => Object.fromEntries(header.map((key, index) => [key, values[index] || ""])));
}

function groupBy(rows: CsvRow[], key: (row: CsvRow) => string): Map<string, CsvRow[]> {
  const result = new Map<string, CsvRow[]>();
  for (const row of rows) result.set(key(row), [...(result.get(key(row)) || []), row]);
  return result;
}

function closingKey(row: CsvRow): string { return `${row.Z_KASSE_ID}|${row.Z_NR}`; }
function receiptKey(row: CsvRow): string { return `${closingKey(row)}|${row.BON_ID}`; }
function number(value: string): number { const parsed = Number(value || 0); if (!Number.isFinite(parsed)) throw new Error(`Ungültige Zahl im DSFinV-K-Export: ${value}`); return parsed; }
function money(value: string): number { return roundMoney(number(value)); }
function paymentMethod(value: string): PaymentMethod { const normalized = value.toLowerCase(); if (normalized === "bar") return "cash"; if (normalized === "unbar") return "card"; return "bank"; }
function normalizeTaxRate(value: number): 0 | 7 | 19 { if (Math.abs(value - 19) < 0.01) return 19; if (Math.abs(value - 7) < 0.01) return 7; return 0; }
function normalizeTaxKey(value: string): 0 | 7 | 19 { return value === "1" ? 19 : value === "2" ? 7 : 0; }
function revenueAccount(rate: number): string { return rate === 19 ? "8400" : rate === 7 ? "8300" : "8600"; }
function paymentCounterAccount(method: PaymentMethod): string { return ({ cash: "1000", card: "1360", bank: "1200", paypal: "1370" } as const)[method]; }
function sumWhere(rows: CsvRow[], predicate: (row: CsvRow) => boolean, field: string): number { return rows.filter(predicate).reduce((sum, row) => sum + number(row[field]), 0); }
function sumBusiness(rows: CsvRow[], types: string[]): number { return rows.filter((row) => types.includes(row.GV_TYP)).reduce((sum, row) => sum + number(row.Z_UMS_BRUTTO), 0); }
function sumRate(items: DsfinvkAllocation[], rate: number, field: "gross" | "net" | "tax"): number { return items.filter((item) => item.taxRate === rate).reduce((sum, item) => sum + item[field], 0); }

function addAllocation(map: Map<string, DsfinvkAllocation>, input: DsfinvkAllocation) {
  const key = `${input.paymentMethod}|${input.taxRate}|${input.accountCode}`;
  const current = map.get(key);
  if (!current) map.set(key, { ...input });
  else map.set(key, { ...current, gross: current.gross + input.gross, net: current.net + input.net, tax: current.tax + input.tax });
}

function assertClose(actual: number, expected: number, label: string) {
  const difference = roundMoney(expected - actual);
  if (Math.abs(difference) > TOLERANCE) {
    throw new Error(`${label} ist nicht stimmig: berechnet ${formatMoney(actual)}, erwartet ${formatMoney(expected)}, Differenz ${formatMoney(difference)}.`);
  }
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function roundMoney(value: number): number { return Math.round((value + Number.EPSILON) * 100) / 100; }
function formatMoney(value: number): string { return `${new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} €`; }
