import { resolveBookkeepingRule } from "./bookkeeping-rules";
import type { BusinessDocument } from "./types";

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
    code: "3430",
    label: "SIM Karten Einkauf",
    defaultTaxRate: 19,
    keywords: ["sim karte", "simkarte", "lyca", "lycamobile"],
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
    keywords: ["paypal", "flatpay", "gebuehr", "gebühr", "bankgebuehr", "bankgebühr"],
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
  const fixed = resolveBookkeepingRule({
    name: vendor,
    text: ocrText,
    context: "supplierInvoice",
  });
  if (fixed && fixed.direction === "expense") {
    const known = SUPPLIER_BOOKKEEPING_ACCOUNTS.find((account) => account.code === fixed.accountCode);
    if (known) return known;
  }

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
