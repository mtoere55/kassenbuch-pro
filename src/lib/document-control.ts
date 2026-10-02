import type { AppState, BusinessDocument, LedgerEntry } from "./types";

export interface SupplierInvoiceFingerprintInput {
  vendor: string;
  date: string;
  gross: number;
  invoiceNumber?: string;
  fileName?: string;
}

export interface BookkeepingAccount {
  code: string;
  label: string;
  defaultTaxRate: 0 | 7 | 19;
  keywords: string[];
}

export interface BankStatementEvidence {
  isLikelyBankStatement: boolean;
  score: number;
  signals: string[];
}

export function detectBankStatementEvidence(text: string): BankStatementEvidence {
  const normalized = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9€]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const weightedSignals: Array<[string, number, RegExp]> = [
    ["Kontoauszug", 4, /\bkontoauszug\b/],
    ["Buchungstag", 2, /\bbuchungstag\b/],
    ["Wertstellung", 2, /\bwertstellung\b/],
    ["Kontostand", 2, /\b(?:alter|neuer|aktueller)?\s*kontostand\b/],
    ["Anfangs-/Endsaldo", 2, /\b(?:anfangssaldo|endsaldo|anfangsbestand|endbestand)\b/],
    ["IBAN", 1, /\biban\b/],
    ["BIC", 1, /\bbic\b/],
    ["Bankumsatz", 2, /\b(?:umsatzanzeige|kontoumsatz|kontoumsaetze|konto umsaetze)\b/],
    ["Soll/Haben", 1, /\b(?:soll|haben)\b/],
  ];

  const signals: string[] = [];
  let score = 0;
  for (const [label, weight, pattern] of weightedSignals) {
    if (!pattern.test(normalized)) continue;
    signals.push(label);
    score += weight;
  }

  const invoiceSignals = [
    /\brechnungsnummer\b/,
    /\brechnungsdatum\b/,
    /\bnettobetrag\b/,
    /\bmehrwertsteuer\b/,
    /\bgesamtbetrag\b/,
  ].filter((pattern) => pattern.test(normalized)).length;

  if (invoiceSignals >= 3 && !/\bkontoauszug\b/.test(normalized)) score = Math.max(0, score - 3);

  const hasCoreBankSignal = /\bkontoauszug\b|\bbuchungstag\b|\bwertstellung\b|\b(?:alter|neuer|aktueller)?\s*kontostand\b/.test(normalized);
  return {
    isLikelyBankStatement: hasCoreBankSignal && score >= 4,
    score,
    signals,
  };
}

export function isLikelyBankStatementText(text?: string | null): boolean {
  return Boolean(text && detectBankStatementEvidence(text).isLikelyBankStatement);
}

export function isMisclassifiedBankStatementEntry(
  state: Pick<AppState, "documents">,
  entry: LedgerEntry,
): boolean {
  if (entry.source !== "scan" || !entry.documentId) return false;
  const document = state.documents.find((item) => item.id === entry.documentId);
  return Boolean(
    document &&
      document.type === "supplierInvoice" &&
      isLikelyBankStatementText(document.ocrText),
  );
}

export const SUPPLIER_BOOKKEEPING_ACCOUNTS: BookkeepingAccount[] = [
  {
    code: "3200",
    label: "Wareneinkauf 19 %",
    defaultTaxRate: 19,
    keywords: ["ware", "zubehoer", "zubehör", "handy", "telefon", "smartphone"],
  },
  {
    code: "3400",
    label: "Ersatzteile und Reparaturmaterial",
    defaultTaxRate: 19,
    keywords: ["display", "akku", "batterie", "ersatzteil", "reparatur", "lcd", "oled"],
  },
  {
    code: "4610",
    label: "Werbekosten",
    defaultTaxRate: 19,
    keywords: ["werbung", "anzeige", "marketing", "google ads", "meta ads", "facebook ads"],
  },
  {
    code: "4930",
    label: "Bürobedarf",
    defaultTaxRate: 19,
    keywords: ["papier", "drucker", "patrone", "toner", "buero", "büro", "office"],
  },
  {
    code: "4970",
    label: "Bank-, Karten- und PayPal-Gebühren",
    defaultTaxRate: 0,
    keywords: ["paypal", "flatpay", "gebuehr", "gebühr", "bankgebuehr", "bankgebühr", "provision"],
  },
  {
    code: "4980",
    label: "Sonstiger Betriebsbedarf",
    defaultTaxRate: 19,
    keywords: [],
  },
];

export function normalizeDocumentText(value?: string | null): string {
  return (value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function supplierInvoiceFallbackKey(input: SupplierInvoiceFingerprintInput): string {
  const vendor = normalizeDocumentText(input.vendor);
  const amountCents = Math.round(input.gross * 100);
  const fileName = normalizeDocumentText(input.fileName);
  return `fallback|${vendor}|${input.date}|${amountCents}|${fileName}`;
}

export function supplierInvoiceDuplicateKey(input: SupplierInvoiceFingerprintInput): string {
  const vendor = normalizeDocumentText(input.vendor);
  const invoiceNumber = normalizeDocumentText(input.invoiceNumber);
  if (invoiceNumber) return `invoice|${vendor}|${invoiceNumber}`;
  return supplierInvoiceFallbackKey(input);
}

function invoiceInputFromDocument(document: BusinessDocument): SupplierInvoiceFingerprintInput | undefined {
  if (document.type !== "supplierInvoice") return undefined;
  const vendor = String(document.metadata?.vendor || "");
  const storedInvoiceNumber = String(document.metadata?.invoiceNumber || "");
  const generatedNumber = /^ER-\d{4}-\d+$/i.test(document.documentNumber);
  return {
    vendor,
    date: document.date,
    gross: document.amount,
    invoiceNumber: storedInvoiceNumber || (generatedNumber ? undefined : document.documentNumber),
    fileName: document.originalFileName,
  };
}

export function supplierInvoiceKeyFromDocument(document: BusinessDocument): string | undefined {
  const input = invoiceInputFromDocument(document);
  return input ? supplierInvoiceDuplicateKey(input) : undefined;
}

export function findSupplierInvoiceDuplicate(
  documents: BusinessDocument[],
  input: SupplierInvoiceFingerprintInput,
): BusinessDocument | undefined {
  const primaryKey = supplierInvoiceDuplicateKey(input);
  const fallbackKey = supplierInvoiceFallbackKey(input);
  return documents.find((document) => {
    const existing = invoiceInputFromDocument(document);
    if (!existing) return false;
    return (
      supplierInvoiceDuplicateKey(existing) === primaryKey ||
      supplierInvoiceFallbackKey(existing) === fallbackKey
    );
  });
}

export function inferSupplierAccount(vendor: string, ocrText: string): BookkeepingAccount {
  const haystack = `${vendor} ${ocrText}`.toLowerCase();
  return (
    SUPPLIER_BOOKKEEPING_ACCOUNTS.find((account) =>
      account.keywords.some((keyword) => haystack.includes(keyword)),
    ) || SUPPLIER_BOOKKEEPING_ACCOUNTS[SUPPLIER_BOOKKEEPING_ACCOUNTS.length - 1]
  );
}

export function getSupplierAccount(code?: string): BookkeepingAccount {
  return (
    SUPPLIER_BOOKKEEPING_ACCOUNTS.find((account) => account.code === code) ||
    SUPPLIER_BOOKKEEPING_ACCOUNTS[SUPPLIER_BOOKKEEPING_ACCOUNTS.length - 1]
  );
}
