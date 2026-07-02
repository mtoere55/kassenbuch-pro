import { getTaxAmountFromGross, roundMoney } from "./accounting";

export interface ParsedZReport {
  type: "zReport";
  date?: string;
  zNumber?: string;
  gross?: number;
  net?: number;
  vat?: number;
  cash?: number;
  card?: number;
  salesCount?: number;
  openingCash?: number;
  expectedCash?: number;
  countedCash?: number;
  difference?: number;
}

export interface ParsedInvoice {
  type: "supplierInvoice";
  date?: string;
  invoiceNumber?: string;
  vendor?: string;
  gross?: number;
  net?: number;
  vat?: number;
}

function parseGermanMoney(value?: string): number | undefined {
  if (!value) return undefined;
  const normalized = value
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^0-9.-]/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? roundMoney(number) : undefined;
}

function findMoney(text: string, labels: string[]): number | undefined {
  for (const label of labels) {
    const regex = new RegExp(`${label}[^\\d-]{0,24}(-?[\\d.]+[,\\.]\\d{2})`, "i");
    const match = text.match(regex);
    if (match) return parseGermanMoney(match[1]);
  }
  return undefined;
}

function parseDate(text: string): string | undefined {
  const match = text.match(/\b(\d{2})[.\/-](\d{2})[.\/-](\d{4})\b/);
  if (!match) return undefined;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

export function detectDocumentType(text: string): "zReport" | "supplierInvoice" {
  return /Tagesabschluss|Z[- ]?Bericht|Verkaufsübersicht/i.test(text)
    ? "zReport"
    : "supplierInvoice";
}

export function parseZReport(text: string): ParsedZReport {
  const zNumber = text.match(/Z[- ]?Bericht[- ]?Nummer\s*:?\s*(\d+)/i)?.[1];
  const salesCount = text.match(/Anzahl\s+Verkäufe\s+(\d+)/i)?.[1];
  const gross = findMoney(text, ["Gesamtumsatz vor Abzug", "Brutto", "Gesamtumsatz"]);
  const net = findMoney(text, ["Umsatz \\(exkl\\. MwSt\\.\\)", "Netto"]);
  const vat = findMoney(text, ["Gesamtsumme der Mehrwertsteuer", "MwSt\\."]);
  const cash = findMoney(text, ["Bar\\s*:?\\s*Verkäufe", "Bar\\s*:?\\s*Einnahmen"]);
  const card = findMoney(text, ["Karte\\s*:?\\s*Verkäufe", "Karte\\s*:?\\s*Einnahmen"]);
  const openingCash = findMoney(text, ["Startbetrag"]);
  const expectedCash = findMoney(text, ["Erwartetes Bargeld"]);
  const countedCash = findMoney(text, ["Gezählter Bargeldbestand"]);
  const difference = findMoney(text, ["Differenz"]);

  return {
    type: "zReport",
    date: parseDate(text),
    zNumber,
    gross,
    net,
    vat,
    cash,
    card,
    salesCount: salesCount ? Number(salesCount) : undefined,
    openingCash,
    expectedCash,
    countedCash,
    difference,
  };
}

export function parseSupplierInvoice(text: string): ParsedInvoice {
  const invoiceNumber = text.match(
    /(?:Rechnungsnummer|Rechnung\s*Nr\.?|Invoice\s*No\.?)\s*:?\s*([A-Z0-9\-/]+)/i,
  )?.[1];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const vendor = lines.find((line) => /[A-Za-zÄÖÜäöüß]{3,}/.test(line))?.slice(0, 80);
  const gross = findMoney(text, ["Gesamtbetrag", "Rechnungsbetrag", "Brutto", "Total"]);
  const net = findMoney(text, ["Nettobetrag", "Netto"]);
  const vat = findMoney(text, ["Umsatzsteuer", "Mehrwertsteuer", "MwSt\\."]);

  return {
    type: "supplierInvoice",
    date: parseDate(text),
    invoiceNumber,
    vendor,
    gross,
    net: net ?? (gross ? roundMoney(gross - (vat ?? getTaxAmountFromGross(gross))) : undefined),
    vat: vat ?? (gross ? getTaxAmountFromGross(gross) : undefined),
  };
}
