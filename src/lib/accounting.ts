import type { TaxMode } from "./types";

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateDifferentialTax(
  salePrice: number,
  purchasePrice: number,
  taxRate = 19,
): number {
  const margin = Math.max(0, salePrice - purchasePrice);
  return roundMoney((margin * taxRate) / (100 + taxRate));
}

export function calculateSaleMetrics(input: {
  salePrice: number;
  purchasePrice: number;
  repairCosts?: number;
  taxMode: TaxMode;
}) {
  const repairCosts = input.repairCosts ?? 0;
  const grossMargin = roundMoney(input.salePrice - input.purchasePrice);
  const differentialVat =
    input.taxMode === "differential"
      ? calculateDifferentialTax(input.salePrice, input.purchasePrice)
      : 0;
  const standardVat =
    input.taxMode === "standard19"
      ? roundMoney((input.salePrice * 19) / 119)
      : 0;
  const taxAmount = differentialVat || standardVat;
  const profitAfterVatAndRepair = roundMoney(
    input.salePrice - input.purchasePrice - repairCosts - taxAmount,
  );
  return { grossMargin, differentialVat, standardVat, taxAmount, profitAfterVatAndRepair };
}

export function getTaxAmountFromGross(gross: number, rate = 19): number {
  return roundMoney((gross * rate) / (100 + rate));
}

export function formatCurrency(value: number, locale = "de-DE"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

export function formatDate(value: string, locale = "de-DE"): string {
  if (!value) return "–";
  return new Intl.DateTimeFormat(locale).format(new Date(`${value}T12:00:00`));
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function makeId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 9);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export function nextSequence(prefix: string, existing: string[], date = new Date()): string {
  const year = date.getFullYear();
  const start = `${prefix}-${year}-`;
  const max = existing
    .filter((value) => value.startsWith(start))
    .map((value) => Number(value.slice(start.length)))
    .filter(Number.isFinite)
    .reduce((highest, current) => Math.max(highest, current), 0);
  return `${start}${String(max + 1).padStart(4, "0")}`;
}

export function normalizeImei(value: string): string {
  return value.replace(/\D/g, "").slice(0, 15);
}

export function isValidImei(value: string): boolean {
  const imei = normalizeImei(value);
  if (!/^\d{15}$/.test(imei)) return false;
  return luhnSum(imei) % 10 === 0;
}

export function expectedImeiCheckDigit(value: string): number | undefined {
  const imei = normalizeImei(value);
  if (imei.length < 14) return undefined;
  const base = imei.slice(0, 14);
  const check = (10 - (luhnSum(base) % 10)) % 10;
  return check;
}

export function getImeiValidationMessage(value: string, label = "IMEI"): string | undefined {
  const imei = normalizeImei(value);
  if (!/^\d{15}$/.test(imei)) return `${label} muss aus genau 15 Ziffern bestehen.`;
  if (isValidImei(imei)) return undefined;
  const expected = expectedImeiCheckDigit(imei);
  return expected === undefined
    ? `${label} ist nicht gültig.`
    : `${label} ist 15-stellig, aber die Prüfziffer stimmt nicht. Bitte letzte Ziffer prüfen: erwartet ${expected}.`;
}

function luhnSum(value: string): number {
  let sum = 0;
  for (let index = 0; index < value.length; index += 1) {
    let digit = Number(value[index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum;
}
