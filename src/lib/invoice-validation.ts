export interface ValidatedInvoiceAmounts {
  gross: number;
  vat: number;
  net: number;
  vatRate: 0 | 7 | 19;
}

const STANDARD_VAT_RATE = 19;
const CENT_TOLERANCE = 0.05;

export function parseDecimal(value: string | number | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (!value) return 0;
  const normalized = value
    .trim()
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function validateSupplierInvoiceAmounts(
  grossInput: number,
  vatInput: number | undefined,
): ValidatedInvoiceAmounts {
  const gross = roundMoney(grossInput);
  const vat = roundMoney(vatInput || 0);

  if (gross <= 0) {
    throw new Error("Bitte einen gültigen Bruttobetrag eingeben.");
  }
  if (vat < 0) {
    throw new Error("Die Mehrwertsteuer darf nicht negativ sein.");
  }
  if (vat >= gross && vat > 0) {
    throw new Error("Die Mehrwertsteuer kann nicht gleich hoch oder höher als der Bruttobetrag sein.");
  }

  const maximumGermanVat = roundMoney((gross * STANDARD_VAT_RATE) / (100 + STANDARD_VAT_RATE));
  if (vat > maximumGermanVat + CENT_TOLERANCE) {
    throw new Error(
      `Die eingetragene MwSt. ist für ${gross.toFixed(2)} € Brutto zu hoch. Bei 19 % sind höchstens ${maximumGermanVat.toFixed(2)} € enthalten.`,
    );
  }

  return {
    gross,
    vat,
    net: roundMoney(gross - vat),
    vatRate: inferGermanVatRate(gross, vat),
  };
}

export function inferGermanVatRate(gross: number, vat: number): 0 | 7 | 19 {
  if (!vat || gross <= 0) return 0;
  const vatAt7 = roundMoney((gross * 7) / 107);
  const vatAt19 = roundMoney((gross * 19) / 119);
  return Math.abs(vat - vatAt7) <= Math.abs(vat - vatAt19) ? 7 : 19;
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
