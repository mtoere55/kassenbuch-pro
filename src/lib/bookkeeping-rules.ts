import type { LedgerDirection, TaxMode } from "./types";

export interface BookkeepingRule {
  key: string;
  label: string;
  aliases: string[];
  purchaseAccount?: string;
  purchaseTaxRate?: 0 | 7 | 19;
  clearingAccount?: string;
  commissionAccount?: string;
}

export interface ResolvedBookkeepingRule {
  key: string;
  label: string;
  accountCode: string;
  taxRate: 0 | 7 | 19;
  taxMode: TaxMode;
  direction: LedgerDirection;
  internalTransfer: boolean;
  requiresInvoiceReview: boolean;
  explanation: string;
}

export const BOOKKEEPING_RULES: BookkeepingRule[] = [
  { key: "aswo", label: "ASWO", aliases: ["aswo", "asbo"], purchaseAccount: "3400", purchaseTaxRate: 19 },
  { key: "otara", label: "otara", aliases: ["otara", "otar"], purchaseAccount: "3400", purchaseTaxRate: 19 },
  { key: "mastrade", label: "MAS Trade", aliases: ["mas trade", "mastrade", "mustrait"], purchaseAccount: "3400", purchaseTaxRate: 19 },
  { key: "lyca", label: "Lyca", aliases: ["lyca", "lycamobile"], purchaseAccount: "3430", purchaseTaxRate: 19 },
  { key: "unitel", label: "UniTel", aliases: ["unitel", "uni tel"], clearingAccount: "1590", commissionAccount: "8510" },
  { key: "prifoto", label: "Prifoto", aliases: ["prifoto", "pri foto"], clearingAccount: "1591", commissionAccount: "8510" },
];

const COMMISSION_WORDS = ["provision", "abrechnung", "gutschrift", "commission", "umsatzbeteiligung"];

export function findBookkeepingRule(value: string): BookkeepingRule | undefined {
  const normalized = normalizeRuleText(value);
  return BOOKKEEPING_RULES.find((rule) =>
    rule.aliases.some((alias) => normalized.includes(normalizeRuleText(alias))),
  );
}

export function resolveBookkeepingRule(input: {
  name?: string;
  text?: string;
  amount?: number;
  context: "supplierInvoice" | "bank" | "cashSale";
}): ResolvedBookkeepingRule | undefined {
  const haystack = `${input.name || ""} ${input.text || ""}`;
  const rule = findBookkeepingRule(haystack);
  if (!rule) return undefined;
  const normalized = normalizeRuleText(haystack);
  const commission = COMMISSION_WORDS.some((word) => normalized.includes(normalizeRuleText(word)));

  if (rule.purchaseAccount) {
    return {
      key: rule.key,
      label: rule.label,
      accountCode: rule.purchaseAccount,
      taxRate: rule.purchaseTaxRate || 19,
      taxMode: "standard19",
      direction: "expense",
      internalTransfer: false,
      requiresInvoiceReview: input.context === "bank",
      explanation: rule.key === "lyca"
        ? "SIM-Karten-Einkauf mit 19 % nach Lieferantenrechnung."
        : "Ersatzteile und Reparaturmaterial mit 19 % nach Lieferantenrechnung.",
    };
  }

  if (commission && rule.commissionAccount) {
    return {
      key: rule.key,
      label: rule.label,
      accountCode: rule.commissionAccount,
      taxRate: 19,
      taxMode: "standard19",
      direction: (input.amount || 0) >= 0 || input.context !== "bank" ? "income" : "expense",
      internalTransfer: false,
      requiresInvoiceReview: true,
      explanation: "Monatsprovision oder Monatsabrechnung mit 19 % nach Abrechnungsbeleg.",
    };
  }

  if (rule.clearingAccount) {
    return {
      key: rule.key,
      label: rule.label,
      accountCode: rule.clearingAccount,
      taxRate: 0,
      taxMode: "taxFree",
      direction: input.context === "cashSale" ? "income" : "transfer",
      internalTransfer: input.context === "bank",
      requiresInvoiceReview: false,
      explanation: rule.key === "prifoto"
        ? "Tägliche Foto-Umsätze ohne erneute Mehrwertsteuer; Steuer aus der Monatsabrechnung."
        : "Guthaben-Geld ohne Mehrwertsteuer; nur die Monatsprovision wird mit 19 % versteuert.",
    };
  }

  return undefined;
}

export function bookkeepingRuleSummary() {
  return [
    { name: "ASWO / otara / MAS Trade", daily: "3400 Ersatzteile", monthly: "19 % nach Rechnung" },
    { name: "Lyca", daily: "3430 SIM-Karten", monthly: "19 % nach Rechnung" },
    { name: "UniTel", daily: "1590 Guthaben-Verrechnung · 0 %", monthly: "8510 Provisionserlöse · 19 %" },
    { name: "Prifoto", daily: "1591 Foto-Verrechnung · 0 %", monthly: "8510 Provision/Abrechnung · 19 %" },
  ];
}

export function normalizeRuleText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
