import { makeId } from "./accounting";
import { getBookingCategory } from "./accounts";
import { reconcileImportedState } from "./transaction-reconciliation";
import type {
  AppState,
  BusinessDocument,
  ImportedTransaction,
  LedgerDirection,
  LedgerEntry,
  PaymentMethod,
  TaxMode,
} from "./types";

export type BankClassification =
  | "cashDeposit"
  | "cardPayout"
  | "paypalFunding"
  | "privateWithdrawal"
  | "bankFee"
  | "salary"
  | "socialInsurance"
  | "rent"
  | "expense"
  | "income"
  | "unknown";

export interface BankStatementTransaction {
  sourceId: string;
  date: string;
  bookingType: string;
  description: string;
  counterparty: string;
  invoiceNumber?: string;
  amount: number;
  classification: BankClassification;
  accountCode: string;
  direction: LedgerDirection;
  internalTransfer: boolean;
  requiresReview: boolean;
}

export interface BankStatementReport {
  statementNumber: string;
  accountNumber: string;
  iban: string;
  periodStart: string;
  periodEnd: string;
  openingBalance: number;
  closingBalance: number;
  transactions: BankStatementTransaction[];
  sourceText: string;
}

export interface BankStatementImportResult {
  state: AppState;
  imported: number;
  createdEntries: number;
  matchedEntries: number;
  internalTransfers: number;
  reviewCount: number;
  skipped: number;
}

export interface BankReviewInput {
  description: string;
  accountCode: string;
  taxRate: 0 | 7 | 19;
  direction: LedgerDirection;
  paymentMethod: PaymentMethod;
}

const MONEY_TOLERANCE = 0.02;
const TRANSACTION_ROW = /^(\d{2}\.\d{2}\.\d{4})\s+(Lastschrift|Dauerauftrag|GutschriftÜberweisung|Gutschrift Überweisung|Überweisung Echtzeit(?:\s*\/\s*Wert:\s*\d{2}\.\d{2}\.\d{4})?|Überweisung o\.Beleg|Bargeldeinzahlung SB(?:\s*\/\s*Wert:\s*\d{2}\.\d{2}\.\d{4})?|Abrechnung.+?)\s+(-?[\d.]+,\d{2})$/i;

export function parseSparkasseStatement(layoutText: string): BankStatementReport {
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
  const opening = joined.match(/Kontostand am\s+(\d{2}\.\d{2}\.\d{4}),\s*Auszug Nr\.\s*\d+\s+([\d.]+,\d{2})/i);
  const closingMatches = [...joined.matchAll(/Kontostand(?:\/Rechnungsabschluss)?(?: in EUR)? am\s+(\d{2}\.\d{2}\.\d{4})(?:\s+um\s+[\d:]+\s+Uhr)?\s+([\d.]+,\d{2})/gi)];
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
    const row = line.match(TRANSACTION_ROW);
    if (row) {
      if (current) rawTransactions.push(current);
      current = {
        date: germanDateToIso(row[1]),
        bookingType: row[2],
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
    const sourceId = `sparkasse:${statement[1]}-${statement[2]}:${stableHash(`${transaction.date}|${transaction.amount}|${transaction.bookingType}|${description}|${index}`)}`;
    return {
      sourceId,
      date: transaction.date,
      bookingType: transaction.bookingType,
      description,
      counterparty: extractCounterparty(description),
      invoiceNumber: extractInvoiceNumber(description),
      amount: transaction.amount,
      ...classified,
    };
  });

  if (!transactions.length) throw new Error("Im Kontoauszug wurden keine Buchungen erkannt.");
  const openingBalance = parseGermanMoney(opening[2]);
  const closingBalance = parseGermanMoney(closing[2]);
  const calculatedClosing = roundMoney(
    openingBalance + transactions.reduce((total, transaction) => total + transaction.amount, 0),
  );
  if (Math.abs(calculatedClosing - closingBalance) > MONEY_TOLERANCE) {
    throw new Error(
      `Kontrollrechnung fehlgeschlagen: berechnet ${money(calculatedClosing)}, PDF-Endbestand ${money(closingBalance)}. Es wird nichts gebucht.`,
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

export function importBankStatement(
  current: AppState,
  report: BankStatementReport,
  fileName: string,
  fileDataUrl?: string,
): BankStatementImportResult {
  const fingerprint = bankStatementFingerprint(report);
  const duplicateDocument = current.documents.find(
    (document) => document.metadata?.bankStatementFingerprint === fingerprint,
  );
  if (duplicateDocument) {
    throw new Error(`Dieser Kontoauszug wurde bereits als ${duplicateDocument.documentNumber} importiert.`);
  }

  const createdAt = new Date().toISOString();
  const documentId = makeId("document");
  const documentNumber = `BANK-${report.periodEnd.slice(0, 7).replace("-", "")}-${report.statementNumber.replace("/", "-")}`;
  const existingImported = current.importedTransactions.filter((item) => item.accountType === "bank");
  const additions: ImportedTransaction[] = [];
  let skipped = 0;

  for (const transaction of report.transactions) {
    const duplicate = existingImported.find((item) =>
      item.externalId === transaction.sourceId || sameTransaction(item, transaction),
    );
    if (duplicate) {
      skipped += 1;
      continue;
    }
    additions.push(toImportedTransaction(transaction, createdAt));
  }

  const statementDocument: BusinessDocument = {
    id: documentId,
    documentNumber,
    type: "zReport",
    date: report.periodEnd,
    amount: report.closingBalance,
    taxAmount: 0,
    taxMode: "taxFree",
    status: "archived",
    originalFileName: fileName,
    originalImageDataUrl: fileDataUrl,
    ocrText: report.sourceText,
    metadata: {
      provider: "Sparkasse an Volme und Ruhr",
      reportKind: "Kontoauszug",
      statementNumber: report.statementNumber,
      accountNumber: report.accountNumber,
      iban: report.iban,
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      openingBalance: report.openingBalance,
      closingBalance: report.closingBalance,
      transactionCount: report.transactions.length,
      bankStatementFingerprint: fingerprint,
      internallyValidated: true,
      automaticallyBooked: true,
    },
    createdAt,
  };

  const reconciled = reconcileImportedState({
    ...current,
    documents: [statementDocument, ...current.documents],
    importedTransactions: [...additions, ...current.importedTransactions],
  }).state;
  const ledger = [...reconciled.ledger];
  let matchedEntries = 0;
  let createdEntries = 0;
  let internalTransfers = 0;
  let reviewCount = 0;

  const importedTransactions = reconciled.importedTransactions.map((imported) => {
    if (!additions.some((item) => item.id === imported.id)) return imported;
    const source = report.transactions.find((item) => item.sourceId === imported.externalId);
    if (!source) return imported;

    if (imported.matchedLedgerEntryId) {
      const index = ledger.findIndex((entry) => entry.id === imported.matchedLedgerEntryId);
      if (index >= 0) {
        ledger[index] = {
          ...ledger[index],
          paymentMethod: "bank",
          counterAccountCode: "1200",
          reconciled: true,
        };
      }
      matchedEntries += 1;
      return { ...imported, bookkeepingStatus: "reviewed" as const };
    }

    const existingLedger = findExistingLedger(ledger, source);
    if (existingLedger) {
      matchedEntries += 1;
      return {
        ...imported,
        matchedLedgerEntryId: existingLedger.id,
        bookkeepingStatus: source.requiresReview ? ("booked" as const) : ("reviewed" as const),
      };
    }

    const entry = createLedgerEntry(source, documentId, documentNumber, fileName, fileDataUrl, createdAt);
    ledger.unshift(entry);
    createdEntries += 1;
    if (source.internalTransfer) internalTransfers += 1;
    if (source.requiresReview) reviewCount += 1;
    return {
      ...imported,
      matchedLedgerEntryId: entry.id,
      bookkeepingStatus: source.requiresReview ? ("booked" as const) : ("reviewed" as const),
      suggestedAccountCode: source.accountCode,
    };
  });

  return {
    imported: additions.length,
    createdEntries,
    matchedEntries,
    internalTransfers,
    reviewCount,
    skipped,
    state: {
      ...reconciled,
      documents: reconciled.documents.map((document) =>
        document.id === statementDocument.id
          ? {
              ...document,
              metadata: {
                ...(document.metadata || {}),
                importedTransactions: additions.length,
                createdLedgerEntries: createdEntries,
                matchedLedgerEntries: matchedEntries,
                reviewCount,
              },
            }
          : document,
      ),
      ledger,
      importedTransactions,
    },
  };
}

export function reviewBankTransaction(
  current: AppState,
  transactionId: string,
  input: BankReviewInput,
): AppState {
  const transaction = current.importedTransactions.find(
    (item) => item.id === transactionId && item.accountType === "bank",
  );
  if (!transaction?.matchedLedgerEntryId) {
    throw new Error("Die Bankbuchung wurde nicht gefunden.");
  }
  const account = getBookingCategory(input.accountCode);
  if (!account || input.accountCode === "0000") {
    throw new Error("Bitte ein gültiges Buchungskonto auswählen.");
  }
  const ledgerEntry = current.ledger.find((entry) => entry.id === transaction.matchedLedgerEntryId);
  if (!ledgerEntry) throw new Error("Die verbundene Buchung wurde nicht gefunden.");
  const amount = Math.abs(transaction.amount);
  const taxMode: TaxMode = input.taxRate > 0 ? "standard19" : "taxFree";
  const taxAmount = input.taxRate > 0 ? roundMoney(amount * input.taxRate / (100 + input.taxRate)) : 0;
  const updated: LedgerEntry = {
    ...ledgerEntry,
    description: input.description.trim() || transaction.counterparty || transaction.description,
    direction: input.direction,
    amount,
    paymentMethod: input.paymentMethod,
    category: `${account.code} · ${account.label}`,
    accountCode: account.code,
    counterAccountCode: input.paymentMethod === "bank" ? "1200" : paymentAccount(input.paymentMethod),
    taxRate: input.taxRate,
    taxAmount,
    taxMode,
    netAmount: roundMoney(amount - taxAmount),
    cashChange: input.paymentMethod === "cash"
      ? input.direction === "income" ? amount : input.direction === "expense" ? -amount : 0
      : 0,
    reconciled: true,
    manualKind: input.direction === "transfer" ? "transfer" : input.direction,
    note: [ledgerEntry.note, "Bank-PDF-Buchung manuell geprüft"].filter(Boolean).join(" · "),
  };
  return {
    ...current,
    ledger: current.ledger.map((entry) => entry.id === updated.id ? updated : entry),
    importedTransactions: current.importedTransactions.map((item) =>
      item.id === transaction.id
        ? { ...item, bookkeepingStatus: "reviewed" as const, suggestedAccountCode: account.code }
        : item,
    ),
  };
}

export function isBankInternalTransaction(transaction: ImportedTransaction): boolean {
  return transaction.accountType === "bank" && (
    transaction.status === "ignored" ||
    transaction.transactionType === "bankFunding" ||
    transaction.description.includes("Umbuchung Bank") ||
    transaction.description.includes("Bargeldeinzahlung") ||
    transaction.description.includes("Flatpay-Auszahlung")
  );
}

export function bankTransactionKindLabel(transaction: ImportedTransaction): string {
  if (transaction.description.includes("Flatpay-Auszahlung")) return "Flatpay → Bank";
  if (transaction.description.includes("Bargeldeinzahlung")) return "Kasse → Bank";
  if (transaction.transactionType === "bankFunding") return "Bank → PayPal";
  if (transaction.description.includes("Privatentnahme")) return "Privat";
  if (transaction.transactionType === "fee") return "Bankgebühr";
  return transaction.amount >= 0 ? "Gutschrift" : "Belastung";
}

export function bankStatementFingerprint(report: BankStatementReport): string {
  return `sparkasse:${report.statementNumber}:${report.periodStart}:${report.periodEnd}:${report.openingBalance.toFixed(2)}:${report.closingBalance.toFixed(2)}`;
}

function toImportedTransaction(
  transaction: BankStatementTransaction,
  createdAt: string,
): ImportedTransaction {
  return {
    id: makeId("import"),
    accountType: "bank",
    date: transaction.date,
    amount: transaction.amount,
    description: importedDescription(transaction),
    externalId: transaction.sourceId,
    transactionType: transaction.classification === "paypalFunding"
      ? "bankFunding"
      : transaction.classification === "bankFee"
        ? "fee"
        : "other",
    currency: "EUR",
    counterparty: transaction.counterparty,
    invoiceNumber: transaction.invoiceNumber,
    suggestedAccountCode: transaction.accountCode,
    bookkeepingStatus: "unbooked",
    matchConfidence: 0,
    status: transaction.internalTransfer ? "ignored" : "new",
    createdAt,
  };
}

function importedDescription(transaction: BankStatementTransaction): string {
  if (transaction.classification === "cardPayout") return `Flatpay-Auszahlung · ${transaction.description}`;
  if (transaction.classification === "cashDeposit") return `Bargeldeinzahlung · ${transaction.description}`;
  if (transaction.classification === "paypalFunding") return `Umbuchung Bank an PayPal · ${transaction.description}`;
  if (transaction.classification === "privateWithdrawal") return `Privatentnahme · ${transaction.description}`;
  return `${transaction.bookingType} · ${transaction.description}`;
}

function createLedgerEntry(
  transaction: BankStatementTransaction,
  documentId: string,
  documentNumber: string,
  fileName: string,
  fileDataUrl: string | undefined,
  createdAt: string,
): LedgerEntry {
  const amount = Math.abs(transaction.amount);
  const account = getBookingCategory(transaction.accountCode);
  const category = account
    ? `${account.code} · ${account.label}`
    : `${transaction.accountCode} · Nicht zugeordnet`;
  const note = transaction.requiresReview
    ? "Automatisch aus Bank-PDF gebucht; Konto, Rechnung und Vorsteuer prüfen"
    : "Automatisch aus rechnerisch geprüftem Bank-PDF gebucht";

  if (transaction.classification === "cashDeposit") {
    return baseLedger(transaction, {
      amount,
      direction: "transfer",
      description: "Umbuchung Kasse an Bank",
      category: "1200 · Bank",
      accountCode: "1200",
      counterAccountCode: "1000",
      cashChange: -amount,
      manualKind: "transfer",
      note,
    }, documentId, documentNumber, fileName, fileDataUrl, createdAt);
  }
  if (transaction.classification === "cardPayout") {
    return baseLedger(transaction, {
      amount,
      direction: "transfer",
      description: `Flatpay-Auszahlung ${transaction.counterparty}`,
      category: "1200 · Bank",
      accountCode: "1200",
      counterAccountCode: "1360",
      cashChange: 0,
      manualKind: "transfer",
      note,
    }, documentId, documentNumber, fileName, fileDataUrl, createdAt);
  }
  if (transaction.classification === "paypalFunding") {
    return baseLedger(transaction, {
      amount,
      direction: "transfer",
      description: `Umbuchung Bank an PayPal ${transaction.counterparty}`,
      category: "1370 · PayPal",
      accountCode: "1370",
      counterAccountCode: "1200",
      cashChange: 0,
      manualKind: "transfer",
      note,
    }, documentId, documentNumber, fileName, fileDataUrl, createdAt);
  }
  if (transaction.classification === "privateWithdrawal") {
    return baseLedger(transaction, {
      amount,
      direction: "transfer",
      description: transaction.description,
      category: "1800 · Privatentnahme",
      accountCode: "1800",
      counterAccountCode: "1200",
      cashChange: 0,
      manualKind: "private",
      note,
    }, documentId, documentNumber, fileName, fileDataUrl, createdAt);
  }

  return baseLedger(transaction, {
    amount,
    direction: transaction.direction,
    description: transaction.counterparty || transaction.description,
    category,
    accountCode: transaction.accountCode,
    counterAccountCode: "1200",
    cashChange: 0,
    manualKind: transaction.direction === "income" ? "income" : "expense",
    note,
  }, documentId, documentNumber, fileName, fileDataUrl, createdAt);
}

function baseLedger(
  transaction: BankStatementTransaction,
  values: Pick<LedgerEntry, "amount" | "direction" | "description" | "category" | "accountCode" | "counterAccountCode" | "cashChange" | "manualKind" | "note">,
  documentId: string,
  documentNumber: string,
  fileName: string,
  fileDataUrl: string | undefined,
  createdAt: string,
): LedgerEntry {
  return {
    id: makeId("ledger"),
    date: transaction.date,
    paymentMethod: "bank",
    source: "bankImport",
    sourceId: transaction.sourceId,
    documentId,
    taxAmount: 0,
    taxRate: 0,
    taxMode: "taxFree",
    reconciled: !transaction.requiresReview,
    documentNumber,
    netAmount: values.amount,
    attachmentFileName: fileName,
    attachmentDataUrl: fileDataUrl,
    createdAt,
    ...values,
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
  if (/bargeldeinzahlung sb|sb-einzahlung/.test(value)) {
    return classification("cashDeposit", "1200", "transfer", true, false);
  }
  if (amount < 0 && /paypal europe/.test(value)) {
    return classification("paypalFunding", "1370", "transfer", true, false);
  }
  if (/^abrechnung|kontoführung|kontofuehrung|entgelte/.test(value)) {
    return classification("bankFee", "4970", "expense", false, false);
  }
  if (amount < 0 && /\bprivat\b/.test(value)) {
    return classification("privateWithdrawal", "1800", "transfer", true, false);
  }
  if (amount < 0 && /\bgehalt\b/.test(value)) {
    return classification("salary", "4120", "expense", false, false);
  }
  if (amount < 0 && /aok|ikk classic|krankenkasse|gesundheitskasse/.test(value)) {
    return classification("socialInsurance", "4130", "expense", false, false);
  }
  if (amount < 0 && /miete|betriebskosten/.test(value)) {
    return classification("rent", "4210", "expense", false, false);
  }
  if (amount < 0 && /unitel|guthaben.?auflade|aufladekart/.test(value)) {
    return classification("expense", "3200", "expense", false, true);
  }
  if (amount < 0 && /aswo/.test(value)) {
    return classification("expense", "3400", "expense", false, true);
  }
  if (amount < 0 && /mark-e|strom|energie/.test(value)) {
    return classification("expense", "4240", "expense", false, true);
  }
  if (amount < 0 && /telefonica germany gmbh|tarifrechnung/.test(value)) {
    return classification("expense", "4920", "expense", false, true);
  }
  if (amount < 0 && /amazon|tchibo|prifoto/.test(value)) {
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

function findExistingLedger(
  ledger: LedgerEntry[],
  transaction: BankStatementTransaction,
): LedgerEntry | undefined {
  const amount = Math.abs(transaction.amount);
  return ledger.find((entry) => {
    if (Math.abs(entry.amount - amount) > MONEY_TOLERANCE) return false;
    if (dateDistance(entry.date, transaction.date) > (transaction.classification === "paypalFunding" ? 5 : 1)) return false;
    if (transaction.classification === "paypalFunding") {
      return entry.direction === "transfer" && entry.accountCode === "1370" && entry.counterAccountCode === "1200";
    }
    if (transaction.classification === "cardPayout") {
      return entry.direction === "transfer" && entry.accountCode === "1200" && entry.counterAccountCode === "1360";
    }
    if (transaction.classification === "cashDeposit") {
      return entry.direction === "transfer" && entry.accountCode === "1200" && entry.counterAccountCode === "1000";
    }
    return entry.paymentMethod === "bank" && entry.direction === transaction.direction && entry.accountCode === transaction.accountCode;
  });
}

function sameTransaction(
  imported: ImportedTransaction,
  transaction: BankStatementTransaction,
): boolean {
  return imported.date === transaction.date &&
    Math.abs(imported.amount - transaction.amount) <= MONEY_TOLERANCE &&
    normalize(imported.counterparty || imported.description).includes(normalize(transaction.counterparty).slice(0, 12));
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
  return description.split(/\s+(?:\/INV\/|ReNr|KdNr|DATUM|BIC|IBAN|Gläubiger-ID|\d{9,})/i)[0].slice(0, 80).trim();
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

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function dateDistance(left: string, right: string): number {
  return Math.abs(new Date(`${left}T12:00:00Z`).getTime() - new Date(`${right}T12:00:00Z`).getTime()) / 86_400_000;
}

function paymentAccount(method: PaymentMethod): string {
  return ({ cash: "1000", card: "1360", bank: "1200", paypal: "1370" } as const)[method];
}

function money(value: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
