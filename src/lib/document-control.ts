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

export function supplierInvoiceDuplicateKey(input: SupplierInvoiceFingerprintInput): string {
  const vendor = normalizeDocumentText(input.vendor);
  const invoiceNumber = normalizeDocumentText(input.invoiceNumber);
  if (invoiceNumber) return `invoice|${vendor}|${invoiceNumber}`;

  const amountCents = Math.round(input.gross * 100);
  const fileName = normalizeDocumentText(input.fileName);
  return `fallback|${vendor}|${input.date}|${amountCents}|${fileName}`;
}

export function supplierInvoiceKeyFromDocument(document: BusinessDocument): string | undefined {
  if (document.type !== "supplierInvoice") return undefined;
  const vendor = String(document.metadata?.vendor || "");
  const storedInvoiceNumber = String(document.metadata?.invoiceNumber || "");
  const generatedNumber = /^ER-\d{4}-\d+$/i.test(document.documentNumber);
  return supplierInvoiceDuplicateKey({
    vendor,
    date: document.date,
    gross: document.amount,
    invoiceNumber: storedInvoiceNumber || (generatedNumber ? undefined : document.documentNumber),
    fileName: document.originalFileName,
  });
}

export function findSupplierInvoiceDuplicate(
  documents: BusinessDocument[],
  input: SupplierInvoiceFingerprintInput,
): BusinessDocument | undefined {
  const key = supplierInvoiceDuplicateKey(input);
  return documents.find((document) => supplierInvoiceKeyFromDocument(document) === key);
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
