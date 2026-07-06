import { makeId } from "./accounting";
import type { ImportedTransaction, ImportedTransactionType } from "./types";

function splitCsvLine(line: string, delimiter: string): string[] {
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
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

function parseAmount(value: string): number {
  const cleaned = value.replace(/[^0-9,.-]/g, "").trim();
  if (!cleaned) return 0;
  if (cleaned.includes(",") && cleaned.includes(".")) {
    return Number(cleaned.replace(/\./g, "").replace(",", "."));
  }
  if (cleaned.includes(",")) return Number(cleaned.replace(",", "."));
  return Number(cleaned);
}

function parseDate(value: string): string {
  const de = value.match(/(\d{2})[.\/-](\d{2})[.\/-](\d{4})/);
  if (de) return `${de[3]}-${de[2]}-${de[1]}`;
  const iso = value.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  return iso ?? new Date().toISOString().slice(0, 10);
}

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase();
}

function findHeaderIndex(headers: string[], names: string[]) {
  return headers.findIndex((header) => names.some((name) => header.includes(name)));
}

function valueAt(values: string[], index: number): string {
  return index >= 0 ? values[index] ?? "" : "";
}

export function parseTransactionsCsv(
  csvText: string,
  accountType: "bank" | "paypal",
): ImportedTransaction[] {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes(";") ? ";" : ",";
  const headers = splitCsvLine(lines[0], delimiter).map(normalizeHeader);

  if (accountType === "paypal" && isDetailedPayPalReport(headers)) {
    return parseDetailedPayPalReport(lines.slice(1), headers, delimiter);
  }

  const dateIndex = findHeaderIndex(headers, ["datum", "date", "buchungstag"]);
  const amountIndex = findHeaderIndex(headers, ["betrag", "amount", "brutto"]);
  const descriptionIndex = findHeaderIndex(headers, [
    "verwendungszweck",
    "beschreibung",
    "name",
    "description",
    "betreff",
  ]);
  const idIndex = findHeaderIndex(headers, ["transaktionscode", "transaction id", "referenz", "id"]);

  return lines.slice(1).flatMap((line) => {
    const values = splitCsvLine(line, delimiter);
    const amount = parseAmount(valueAt(values, amountIndex));
    if (!Number.isFinite(amount) || amount === 0) return [];
    return [
      {
        id: makeId("import"),
        accountType,
        date: parseDate(valueAt(values, dateIndex)),
        amount,
        description: valueAt(values, descriptionIndex) || "Importierter Umsatz",
        externalId: valueAt(values, idIndex) || undefined,
        transactionType: "other" as const,
        matchConfidence: 0,
        status: "new" as const,
        createdAt: new Date().toISOString(),
      },
    ];
  });
}

function isDetailedPayPalReport(headers: string[]): boolean {
  return (
    headers.includes("beschreibung") &&
    headers.includes("brutto") &&
    headers.includes("entgelt") &&
    headers.includes("netto") &&
    headers.includes("transaktionscode") &&
    headers.includes("zugehöriger transaktionscode")
  );
}

function parseDetailedPayPalReport(
  lines: string[],
  headers: string[],
  delimiter: string,
): ImportedTransaction[] {
  const index = {
    date: findHeaderIndex(headers, ["datum"]),
    time: findHeaderIndex(headers, ["uhrzeit"]),
    description: findHeaderIndex(headers, ["beschreibung"]),
    currency: findHeaderIndex(headers, ["währung", "waehrung", "currency"]),
    gross: findHeaderIndex(headers, ["brutto"]),
    fee: findHeaderIndex(headers, ["entgelt", "gebühr", "fee"]),
    net: findHeaderIndex(headers, ["netto"]),
    balance: findHeaderIndex(headers, ["guthaben", "balance"]),
    externalId: findHeaderIndex(headers, ["transaktionscode"]),
    email: findHeaderIndex(headers, ["absender e-mail-adresse", "absender email"]),
    counterparty: findHeaderIndex(headers, ["name"]),
    invoice: findHeaderIndex(headers, ["rechnungsnummer", "invoice"]),
    relatedId: findHeaderIndex(headers, ["zugehöriger transaktionscode"]),
  };

  return lines.flatMap((line) => {
    const values = splitCsvLine(line, delimiter);
    const gross = parseAmount(valueAt(values, index.gross));
    const fee = parseAmount(valueAt(values, index.fee));
    const net = parseAmount(valueAt(values, index.net));
    if (![gross, fee, net].some((value) => Number.isFinite(value) && value !== 0)) return [];

    const rawDescription = valueAt(values, index.description) || "PayPal-Transaktion";
    const transactionType = classifyPayPalTransaction(rawDescription);
    const counterparty = valueAt(values, index.counterparty) || valueAt(values, index.email);
    const description = paypalDescription(transactionType, rawDescription, counterparty);
    const internalTransfer =
      transactionType === "bankFunding" || transactionType === "bankWithdrawal";

    return [
      {
        id: makeId("import"),
        accountType: "paypal" as const,
        date: parseDate(valueAt(values, index.date)),
        time: valueAt(values, index.time) || undefined,
        amount: gross || net,
        description,
        externalId: valueAt(values, index.externalId) || undefined,
        relatedExternalId: valueAt(values, index.relatedId) || undefined,
        transactionType,
        grossAmount: gross,
        feeAmount: Math.abs(fee),
        netAmount: net,
        balanceAfter: parseAmount(valueAt(values, index.balance)),
        currency: valueAt(values, index.currency) || "EUR",
        counterparty: counterparty || undefined,
        senderEmail: valueAt(values, index.email) || undefined,
        invoiceNumber: valueAt(values, index.invoice) || undefined,
        matchConfidence: 0,
        status: internalTransfer ? ("ignored" as const) : ("new" as const),
        createdAt: new Date().toISOString(),
      },
    ];
  });
}

function classifyPayPalTransaction(description: string): ImportedTransactionType {
  const normalized = description.toLowerCase();
  if (normalized.includes("bankgutschrift auf paypal-konto")) return "bankFunding";
  if (normalized.includes("von nutzer eingeleitete abbuchung")) return "bankWithdrawal";
  if (normalized.includes("rückzahlung") || normalized.includes("refund")) return "refund";
  if (normalized.includes("gebühr") || normalized.includes("fee")) return "fee";
  return "payment";
}

function paypalDescription(
  type: ImportedTransactionType,
  rawDescription: string,
  counterparty: string,
): string {
  if (type === "bankFunding") return "Umbuchung Bank → PayPal";
  if (type === "bankWithdrawal") return "Umbuchung PayPal → Bank";
  return counterparty ? `${rawDescription} · ${counterparty}` : rawDescription;
}

export function summarizeImportedTransactions(transactions: ImportedTransaction[]) {
  const paypal = transactions.filter((transaction) => transaction.accountType === "paypal");
  return {
    total: transactions.length,
    paypalPayments: paypal.filter((transaction) => transaction.transactionType === "payment").length,
    paypalRefunds: paypal.filter((transaction) => transaction.transactionType === "refund").length,
    internalTransfers: paypal.filter(
      (transaction) =>
        transaction.transactionType === "bankFunding" ||
        transaction.transactionType === "bankWithdrawal",
    ).length,
    fees: paypal.reduce((sum, transaction) => sum + (transaction.feeAmount || 0), 0),
  };
}
