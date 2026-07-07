import {
  bankStatementFingerprint,
  bankTransactionKindLabel,
  importBankStatement,
  isBankInternalTransaction,
  parseSparkasseStatement as parseStrictSparkasseStatement,
  reviewBankTransaction,
  type BankClassification,
  type BankReviewInput,
  type BankStatementImportResult,
  type BankStatementReport,
  type BankStatementTransaction,
} from "./bank-statement";
import { resolveBookkeepingRule } from "./bookkeeping-rules";
import type { LedgerDirection } from "./types";

export {
  bankStatementFingerprint,
  bankTransactionKindLabel,
  importBankStatement,
  isBankInternalTransaction,
  reviewBankTransaction,
};
export type {
  BankClassification,
  BankReviewInput,
  BankStatementImportResult,
  BankStatementReport,
  BankStatementTransaction,
};

const MONEY_TOLERANCE = 0.02;
const FLEXIBLE_TRANSACTION_ROW = /^(\d{2}\.\d{2}\.\d{4})\s+(.+?)\s+([+-]?[\d.]+,\d{2})$/;

export function parseSparkasseStatement(layoutText: string): BankStatementReport {
  try {
    return parseStrictSparkasseStatement(layoutText);
  } catch (strictError) {
    try {
      return parseSparkasseStatementFlexible(layoutText);
    } catch (fallbackError) {
      if (fallbackError instanceof Error) throw fallbackError;
      throw strictError;
    }
  }
}

export function parseSparkasseStatementFlexible(layoutText: string): BankStatementReport {
  const lines = layoutText
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const joined = lines.join("\n");

  if (!/Sparkasse\s+an\s+Volme\s+und\s+Ruhr/i.test(joined) || !/Kontoauszug/i.test(joined)) {
    throw new Error("Das PDF ist kein unterstützter Sparkasse-Kontoauszug.");
  }

  const statement = joined.match(/Kontoauszug\s+(\d+)\/(\d{4})/i);
  const account = joined.match(/Konto-Nr\.\s*([\d ]+),\s*(DE\d{2}(?:\s*\d{4}){4}\s*\d{2})/i);
  const opening = joined.match(/Kontostand am\s+(\d{2}\.\d{2}\.\d{4}),\s*Auszug Nr\.\s*\d+\s+([+-]?[\d.]+,\d{2})/i);
  const closingMatches = [...joined.matchAll(/Kontostand(?:\/Rechnungsabschluss)?(?: in EUR)? am\s+(\d{2}\.\d{2}\.\d{4})(?:\s+um\s+[\d:]+\s+Uhr)?\s+([+-]?[\d.]+,\d{2})/gi)];
  const closing = closingMatches.find((match) => /um\s+[\d:]+\s+Uhr/i.test(match[0])) || closingMatches.at(-1);

  if (!statement || !account || !opening || !closing) {
    throw new Error("Kontoauszugsnummer, Konto, Anfangs- oder Endbestand konnten nicht vollständig gelesen werden.");
  }

  const rawTransactions: Array<{
    date: string;
    bookingType: string;
    amount: number;
    descriptionLines: string[];
  }> = [];
  let current: (typeof rawTransactions)[number] | undefined;

  for (const line of lines) {
    const row = line.match(FLEXIBLE_TRANSACTION_ROW);
    if (row && !isBalanceOrHeaderRow(row[2])) {
      if (current) rawTransactions.push(current);
      current = {
        date: germanDateToIso(row[1]),
        bookingType: normalizeBookingType(row[2]),
        amount: parseGermanMoney(row[3]),
        descriptionLines: [],
      };
      continue;
    }

    if (!current || isStatementDecoration(line)) continue;
    current.descriptionLines.push(line);
  }
  if (current) rawTransactions.push(current);

  const transactions = rawTransactions.map((transaction, index) => {
    const description = cleanDescription(transaction.descriptionLines.join(" ")) || transaction.bookingType;
    const classified = classifyBankTransaction(transaction.bookingType, description, transaction.amount);
    return {
      sourceId: `sparkasse:${statement[1]}-${statement[2]}:${stableHash(`${transaction.date}|${transaction.amount}|${transaction.bookingType}|${description}|${index}`)}`,
      date: transaction.date,
      bookingType: transaction.bookingType,
      description,
      counterparty: extractCounterparty(description),
      invoiceNumber: extractInvoiceNumber(description),
      amount: transaction.amount,
      ...classified,
    };
  });

  if (!transactions.length) {
    throw new Error("Im Kontoauszug wurden keine Buchungen erkannt.");
  }

  const openingBalance = parseGermanMoney(opening[2]);
  const closingBalance = parseGermanMoney(closing[2]);
  const transactionTotal = roundMoney(
    transactions.reduce((total, transaction) => total + transaction.amount, 0),
  );
  const calculatedClosing = roundMoney(openingBalance + transactionTotal);
  const difference = roundMoney(closingBalance - calculatedClosing);

  if (Math.abs(difference) > MONEY_TOLERANCE) {
    throw new Error(
      `Kontrollrechnung fehlgeschlagen: ${transactions.length} Buchungen erkannt, ` +
        `Buchungssumme ${money(transactionTotal)}, berechnet ${money(calculatedClosing)}, ` +
        `PDF-Endbestand ${money(closingBalance)}, Differenz ${money(difference)}. ` +
        "Es wird nichts gebucht.",
    );
  }

  return {
    statementNumber: `${statement[1]}/${statement[2]}`,
    accountNumber: account[1].replace(/\s+/g, ""),
    iban: account[2].replace(/\s+/g, ""),
    periodStart: germanDateToIso(opening[1], 1),
    periodEnd: germanDateToIso(closing[1]),
    openingBalance,
    closingBalance,
    transactions,
    sourceText: layoutText,
  };
}

function classifyBankTransaction(
  bookingType: string,
  description: string,
  amount: number,
): Omit<BankStatementTransaction, "sourceId" | "date" | "bookingType" | "description" | "counterparty" | "invoiceNumber" | "amount"> {
  const value = `${bookingType} ${description}`.toLowerCase();
  if (amount > 0 && /shift4|flatpay|fl atpay/.test(value)) {
    return classification("cardPayout", "1200", "transfer", true, false);
  }
  if (/bargeldeinzahlung|sb-einzahlung|bareinzahlung/.test(value)) {
    return classification("cashDeposit", "1200", "transfer", true, false);
  }
  if (/barauszahlung|barabhebung|geldautomat/.test(value)) {
    return classification("cashDeposit", "1000", "transfer", true, false);
  }
  if (amount < 0 && /paypal europe/.test(value)) {
    return classification("paypalFunding", "1370", "transfer", true, false);
  }

  const fixedRule = resolveBookkeepingRule({
    name: extractCounterparty(description),
    text: `${bookingType} ${description}`,
    amount,
    context: "bank",
  });
  if (fixedRule) {
    return classification(
      fixedRule.direction === "income" ? "income" : fixedRule.direction === "expense" ? "expense" : "unknown",
      fixedRule.accountCode,
      fixedRule.direction,
      fixedRule.internalTransfer,
      fixedRule.requiresInvoiceReview,
    );
  }

  if (/abrechnung|kontoführung|kontofuehrung|entgelte|bankpreis|gebühr|gebuehr/.test(value)) {
    return classification("bankFee", "4970", "expense", false, false);
  }
  if (amount < 0 && /\bprivat\b/.test(value)) {
    return classification("privateWithdrawal", "1800", "transfer", true, false);
  }
  if (amount < 0 && /\bgehalt\b|lohn/.test(value)) {
    return classification("salary", "4120", "expense", false, false);
  }
  if (amount < 0 && /aok|ikk classic|krankenkasse|gesundheitskasse/.test(value)) {
    return classification("socialInsurance", "4130", "expense", false, false);
  }
  if (amount < 0 && /miete|betriebskosten/.test(value)) {
    return classification("rent", "4210", "expense", false, false);
  }
  if (amount < 0 && /mark-e|strom|energie/.test(value)) {
    return classification("expense", "4240", "expense", false, true);
  }
  if (amount < 0 && /telefonica germany gmbh|tarifrechnung/.test(value)) {
    return classification("expense", "4920", "expense", false, true);
  }
  if (amount < 0 && /amazon|tchibo/.test(value)) {
    return classification("expense", "4980", "expense", false, true);
  }
  if (amount > 0 && /google ireland/.test(value)) {
    return classification("income", "4610", "income", false, true);
  }
  if (amount > 0 && /telefonica sagt danke|ortel sagt danke|dpd deutschland/.test(value)) {
    return classification("income", "2740", "income", false, true);
  }
  return amount < 0
    ? classification("unknown", "0000", "expense", false, true)
    : classification("unknown", "0000", "income", false, true);
}

function classification(
  classificationValue: BankClassification,
  accountCode: string,
  direction: LedgerDirection,
  internalTransfer: boolean,
  requiresReview: boolean,
) {
  return {
    classification: classificationValue,
    accountCode,
    direction,
    internalTransfer,
    requiresReview,
  };
}

function isBalanceOrHeaderRow(value: string): boolean {
  return /kontostand|kontoauszug|rechnungsabschluss|auszug nr|seite \d|betrag eur/i.test(value);
}

function normalizeBookingType(value: string): string {
  return value
    .replace(/\s*\/\s*Wert:\s*\d{2}\.\d{2}\.\d{4}\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCounterparty(description: string): string {
  const known = [
    /SHIFT4 LIMITED/i,
    /Shift4 Limited/i,
    /PayPal Europe S\.a\.r\.l\. et Cie S\.C\.A/i,
    /Tchibo Coffee Service GmbH/i,
    /Dr\.K\.Junker/i,
    /Gülbahar Sun/i,
    /MURAT TOERE/i,
    /Prifoto GmbH/i,
    /ASWO International Service GmbH/i,
    /otara GmbH/i,
    /MAS Trade/i,
    /Lyca(?:mobile)?/i,
    /AOK NORDWEST/i,
    /IKK classic/i,
    /UniTel/i,
    /Google Ireland Limited/i,
    /Telefonica Germany[^/]*?(?=\s+(?:Kd-Nr|Telefonica sagt|\+ Co|$))/i,
    /Ortel Mobile GmbH/i,
    /DPD Deutschland GmbH/i,
    /Mark-E Aktiengesellschaft/i,
    /AMAZON[^/]*?(?=\s+(?:D01|302-|$))/i,
  ];
  for (const pattern of known) {
    const match = description.match(pattern);
    if (match) return match[0].replace(/\s+/g, " ").trim();
  }
  const paypalMerchant = description.match(/Einkauf bei\s+(.+?)\s+\d{8,}/i);
  if (paypalMerchant) return paypalMerchant[1].trim();
  return description
    .split(/\s+(?:\/INV\/|ReNr|KdNr|DATUM|BIC|IBAN|Gläubiger-ID|\d{9,})/i)[0]
    .slice(0, 80)
    .trim();
}

function extractInvoiceNumber(description: string): string | undefined {
  return description.match(/(?:ReNr|Rg-Nr\.|Rechnungsnummer)\s*[: ]?\s*([A-Z0-9-]+)/i)?.[1] ||
    description.match(/\/INV\/([^\s]+)/i)?.[1];
}

function cleanDescription(description: string): string {
  return description
    .replace(/Sparkasse an Volme und Ruhr.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isStatementDecoration(line: string): boolean {
  return /^(?:S Sparkasse|Sparkasse an Volme|Kontoauszug|Konto-Nr\.|Seite \d+|Datum\s+Erläuterung|Betrag EUR|Kontostand am|Anzahl Anlagen|Sparkassen-Karree|Anstalt des|HR Nr\.|Sparkassen-Finanzgruppe|Vorstand:|Markus Hacke|Frank Mohrherr|Thorsten Haering|Telefon \d|Fax \d|www\.|kontakt@|BIC:|BLZ:|USt-IdNr|Rechnungsabschluss:|Abrechnungszeitraum|Kontostand\/Rechnungsabschluss|Rechnungsnummer:|Bitte beachten Sie|Hinweise zum Kontoauszug:|Sehr geehrte|Mit freundlichen Grüßen|Ihre Sparkasse)/i.test(line);
}

function germanDateToIso(value: string, nextDay = 0): string {
  const match = value.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!match) throw new Error(`Ungültiges Datum: ${value}`);
  const date = new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]) + nextDay));
  return date.toISOString().slice(0, 10);
}

function parseGermanMoney(value: string): number {
  const amount = Number(value.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(amount)) throw new Error(`Ungültiger Betrag: ${value}`);
  return roundMoney(amount);
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function money(value: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
