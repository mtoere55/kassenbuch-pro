import { makeId } from "./accounting";
import { preparePayPalBookkeeping, type PayPalPostingResult } from "./paypal-bookkeeping";
import type { AppState, BusinessDocument, ImportedTransaction, ImportedTransactionType } from "./types";

const TOLERANCE = 0.02;

export interface PayPalMonthlyStatement {
  merchantId: string;
  paypalId: string;
  periodStart: string;
  periodEnd: string;
  openingBalance: number;
  closingBalance: number;
  receivedPayments: number;
  sentPayments: number;
  debits: number;
  credits: number;
  fees: number;
  transactions: ImportedTransaction[];
  fingerprint: string;
  sourceText: string;
}

export interface PayPalPdfImportResult extends PayPalPostingResult {
  importedTransactions: number;
  archived: boolean;
  report: PayPalMonthlyStatement;
}

export function isPayPalMonthlyStatementText(text: string): boolean {
  const value = normalizeText(text).toLowerCase();
  return value.includes("paypal") &&
    value.includes("kontoauszug") &&
    value.includes("transaktionsübersicht") &&
    value.includes("händlerkonto-id");
}

export function parsePayPalMonthlyStatement(text: string): PayPalMonthlyStatement {
  const source = normalizeText(text);
  if (!isPayPalMonthlyStatementText(source)) {
    throw new Error("Die Datei wurde nicht als PayPal-Monatskontoauszug erkannt.");
  }

  const merchantId = requiredMatch(source, /Händlerkonto-ID:\s*([A-Z0-9]+)/i, "Händlerkonto-ID");
  const paypalId = requiredMatch(source, /PayPal-ID:\s*([^\s]+@[^\s]+)/i, "PayPal-ID");
  const period = source.match(/(\d{2}\.\d{2}\.\d{2})\s*-\s*(\d{2}\.\d{2}\.\d{2})/);
  if (!period) throw new Error("Der Zeitraum des PayPal-Kontoauszugs wurde nicht erkannt.");
  const periodStart = parseShortGermanDate(period[1]);
  const periodEnd = parseShortGermanDate(period[2]);

  const openingBalance = summaryAmount(source, "Verfügbares Guthaben \\(alt\\)");
  const receivedPayments = summaryAmount(source, "Erhaltene Zahlungen");
  const sentPayments = summaryAmount(source, "Gesendete Zahlungen");
  const debits = summaryAmount(source, "Abbuchungen und Belastungen");
  const credits = summaryAmount(source, "Einzahlungen und Gutschriften");
  const fees = summaryAmount(source, "Gebühren");
  const closingBalance = summaryAmount(source, "Verfügbares Guthaben \\(neu\\)");

  const sectionIndex = source.search(/Transaktionsübersicht\s*-\s*EUR/i);
  if (sectionIndex < 0) throw new Error("Die PayPal-Transaktionsübersicht wurde nicht gefunden.");
  const section = source.slice(sectionIndex);
  const transactions = parseTransactionTable(section);

  if (!transactions.length) {
    throw new Error("Im PayPal-Kontoauszug wurden keine Einzeltransaktionen erkannt.");
  }

  const transactionSum = roundMoney(transactions.reduce((sum, transaction) => sum + (transaction.netAmount ?? transaction.amount), 0));
  const expectedMovement = roundMoney(receivedPayments + sentPayments + debits + credits + fees);
  assertClose(transactionSum, expectedMovement, "PayPal-Transaktionssumme");
  assertClose(roundMoney(openingBalance + transactionSum), closingBalance, "PayPal-Saldo");

  const sentFromRows = roundMoney(transactions
    .filter((transaction) => transaction.transactionType === "payment" && transaction.amount < 0)
    .reduce((sum, transaction) => sum + transaction.amount, 0));
  const fundingFromRows = roundMoney(transactions
    .filter((transaction) => transaction.transactionType === "bankFunding")
    .reduce((sum, transaction) => sum + transaction.amount, 0));
  assertClose(sentFromRows, sentPayments, "Gesendete PayPal-Zahlungen");
  assertClose(fundingFromRows, credits, "PayPal-Bankgutschriften");

  const fingerprint = `paypal-statement:${merchantId}:${periodStart}:${periodEnd}:${closingBalance.toFixed(2)}:${transactions.length}`;
  return {
    merchantId,
    paypalId,
    periodStart,
    periodEnd,
    openingBalance,
    closingBalance,
    receivedPayments,
    sentPayments,
    debits,
    credits,
    fees,
    transactions,
    fingerprint,
    sourceText: text,
  };
}

export function importPayPalMonthlyStatement(
  current: AppState,
  report: PayPalMonthlyStatement,
  fileName: string,
  fileDataUrl?: string,
): PayPalPdfImportResult {
  const existingArchive = current.documents.find(
    (document) => document.metadata?.paypalStatementFingerprint === report.fingerprint,
  );
  if (existingArchive) {
    throw new Error(`Dieser PayPal-Monatskontoauszug wurde bereits als ${existingArchive.documentNumber} importiert.`);
  }

  const existingKeys = new Set(
    current.importedTransactions
      .filter((transaction) => transaction.accountType === "paypal")
      .map((transaction) => transaction.externalId
        ? `id:${transaction.externalId}`
        : `fallback:${transaction.date}:${transaction.amount}:${transaction.description}`),
  );
  const uniqueTransactions = report.transactions.filter((transaction) => {
    const key = transaction.externalId
      ? `id:${transaction.externalId}`
      : `fallback:${transaction.date}:${transaction.amount}:${transaction.description}`;
    if (existingKeys.has(key)) return false;
    existingKeys.add(key);
    return true;
  });

  const createdAt = new Date().toISOString();
  const archive: BusinessDocument = {
    id: makeId("document"),
    documentNumber: `PAYPAL-${report.periodStart.slice(0, 7).replace("-", "")}`,
    type: "zReport",
    date: report.periodEnd,
    amount: roundMoney(Math.abs(report.sentPayments)),
    taxAmount: 0,
    taxMode: "taxFree",
    paymentMethod: "paypal",
    status: "archived",
    originalFileName: fileName,
    originalImageDataUrl: fileDataUrl,
    ocrText: report.sourceText,
    metadata: {
      provider: "PayPal",
      reportKind: "Monatskontoauszug",
      merchantId: report.merchantId,
      paypalId: report.paypalId,
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      openingBalance: report.openingBalance,
      closingBalance: report.closingBalance,
      sentPayments: report.sentPayments,
      receivedPayments: report.receivedPayments,
      credits: report.credits,
      debits: report.debits,
      fees: report.fees,
      transactionCount: report.transactions.length,
      paypalStatementFingerprint: report.fingerprint,
      internallyValidated: true,
    },
    createdAt,
  };

  const merged: AppState = {
    ...current,
    documents: [archive, ...current.documents],
    importedTransactions: [...uniqueTransactions, ...current.importedTransactions],
  };
  const posting = preparePayPalBookkeeping(merged);

  return {
    ...posting,
    importedTransactions: uniqueTransactions.length,
    archived: true,
    report,
  };
}

function parseTransactionTable(section: string): ImportedTransaction[] {
  const lines = section.split("\n").map((line) => line.trimEnd());
  const result: ImportedTransaction[] = [];
  let pendingType = "";
  let currentType = "";

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    if (/^(Hinweis:|Copyright|Boulevard Royal|Seite\s+\d+|Händlerkonto-ID:|Transaktionsübersicht\s*-\s*EUR|Datum\s+Typ\s+Name)/i.test(line)) {
      pendingType = "";
      currentType = "";
      continue;
    }

    if (isTypePrefix(line)) {
      pendingType = line;
      continue;
    }

    const dateMatch = line.match(/^(\d{2}\.\d{2}\.\d{2})\b/);
    if (!dateMatch) {
      if (result.length && isTypeContinuation(line)) {
        currentType = `${currentType} ${line}`.trim();
        const last = result[result.length - 1];
        last.description = descriptionFor(last.transactionType || "other", currentType, last.counterparty);
      }
      continue;
    }

    const typeText = pendingType;
    pendingType = "";
    currentType = typeText;
    const date = parseShortGermanDate(dateMatch[1]);
    const externalId = line.match(/\b[A-Z0-9]{17}\b/)?.[0];
    if (!externalId) {
      throw new Error(`Transaktionscode am ${dateMatch[1]} konnte nicht erkannt werden.`);
    }
    const values = [...line.matchAll(/-?\d{1,3}(?:\.\d{3})*,\d{2}/g)].map((match) => parseGermanMoney(match[0]));
    if (values.length < 3) {
      throw new Error(`Beträge der PayPal-Transaktion ${externalId} konnten nicht vollständig gelesen werden.`);
    }
    const [gross, fee, net] = values.slice(-3);
    const transactionType = classifyType(typeText, gross);
    const counterparty = transactionType === "bankFunding" || transactionType === "bankWithdrawal"
      ? undefined
      : extractCounterparty(line, externalId);
    const internal = transactionType === "bankFunding" || transactionType === "bankWithdrawal";

    result.push({
      id: makeId("import"),
      accountType: "paypal",
      date,
      amount: gross || net,
      description: descriptionFor(transactionType, typeText, counterparty),
      externalId,
      transactionType,
      grossAmount: gross,
      feeAmount: Math.abs(fee),
      netAmount: net,
      currency: "EUR",
      counterparty,
      matchConfidence: 0,
      status: internal ? "ignored" : "new",
      createdAt: new Date().toISOString(),
    });
  }

  return result;
}

function isTypePrefix(line: string): boolean {
  return /^(PayPal Express[- ]?|Bankgutschrift|Von Nutzer eingeleitete|Rückzahlung|Refund|Gebühr)/i.test(line);
}

function isTypeContinuation(line: string): boolean {
  return /^(Zahlung|auf PayPal-Konto|Abbuchung)$/i.test(line);
}

function classifyType(typeText: string, gross: number): ImportedTransactionType {
  const value = typeText.toLowerCase();
  if (value.includes("bankgutschrift")) return "bankFunding";
  if (value.includes("abbuchung")) return "bankWithdrawal";
  if (value.includes("rückzahlung") || value.includes("refund")) return "refund";
  if (value.includes("gebühr")) return "fee";
  if (value.includes("paypal express") || value.includes("zahlung")) return "payment";
  return gross >= 0 ? "other" : "payment";
}

function descriptionFor(
  type: ImportedTransactionType,
  rawType: string,
  counterparty?: string,
): string {
  if (type === "bankFunding") return "Umbuchung Bank → PayPal";
  if (type === "bankWithdrawal") return "Umbuchung PayPal → Bank";
  if (type === "refund") return `PayPal Rückzahlung${counterparty ? ` · ${counterparty}` : ""}`;
  if (type === "fee") return "PayPal-Gebühr";
  const label = rawType.replace(/[-\s]+$/g, "").trim() || "PayPal-Zahlung";
  return counterparty ? `${label} · ${counterparty}` : label;
}

function extractCounterparty(line: string, externalId: string): string | undefined {
  const dateRemoved = line.replace(/^\d{2}\.\d{2}\.\d{2}\s*/, "");
  const beforeId = dateRemoved.split(externalId)[0] || "";
  const cleaned = beforeId
    .replace(/\b\S*@\S+\b/g, " ")
    .replace(/\beu_eur_managed_[a-z_]*\b/gi, " ")
    .replace(/\b[a-z]*ayments@ebay\.co\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || undefined;
}

function summaryAmount(source: string, labelPattern: string): number {
  const pattern = new RegExp(`${labelPattern}\\s+(-?[\\d.]+,\\d{2})`, "i");
  const match = source.match(pattern);
  if (!match) throw new Error(`PayPal-Zusammenfassung fehlt: ${labelPattern.replace(/\\/g, "")}.`);
  return parseGermanMoney(match[1]);
}

function normalizeText(value: string): string {
  return value
    .replace(/\r/g, "")
    .replace(/[\u000c\u00ad\ufffe]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

function requiredMatch(source: string, pattern: RegExp, label: string): string {
  const value = source.match(pattern)?.[1]?.trim();
  if (!value) throw new Error(`${label} wurde im PayPal-Kontoauszug nicht erkannt.`);
  return value;
}

function parseShortGermanDate(value: string): string {
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (!match) throw new Error(`Ungültiges PayPal-Datum ${value}.`);
  return `20${match[3]}-${match[2]}-${match[1]}`;
}

function parseGermanMoney(value: string): number {
  const parsed = Number(value.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(parsed)) throw new Error(`Ungültiger PayPal-Betrag ${value}.`);
  return roundMoney(parsed);
}

function assertClose(actual: number, expected: number, label: string) {
  const difference = roundMoney(expected - actual);
  if (Math.abs(difference) > TOLERANCE) {
    throw new Error(`${label} ist nicht stimmig: berechnet ${money(actual)}, erwartet ${money(expected)}, Differenz ${money(difference)}.`);
  }
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function money(value: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value);
}
