import { getBookingCategory } from "./accounts";
import type { AppState, LedgerDirection, LedgerEntry } from "./types";

type ManualKind = NonNullable<LedgerEntry["manualKind"]>;

export type ConfiguredBankClassification =
  | "cashDeposit"
  | "cardPayout"
  | "paypalFunding"
  | "privateWithdrawal"
  | "bankFee"
  | "salary"
  | "socialInsurance"
  | "rent"
  | "expense"
  | "income";

export interface ConfiguredBusinessRule {
  key: string;
  label: string;
  accountCode: string;
  direction: LedgerDirection;
  manualKind: ManualKind;
  classification: ConfiguredBankClassification;
  internalTransfer: boolean;
  documentRequired: boolean;
  recommendedTaxRate: 0 | 7 | 19;
  counterAccountCode: string;
  cashEffect?: "deposit";
  explanation: string;
}

export interface KasRuleInput {
  categoryCode: number;
  description: string;
  signedAmount: number;
  taxRate: number;
}

export interface ConfiguredKasRule {
  accountCode: string;
  direction: LedgerDirection;
  manualKind: ManualKind;
  taxRate: 0 | 7 | 19;
  explanation: string;
}

export function resolveConfiguredBankRule(text: string, amount: number): ConfiguredBusinessRule | undefined {
  const value = normalizeRuleText(text);

  if (amount > 0 && includesAny(value, ["shift4", "flatpay", "fl atpay"])) {
    return rule("flatpay-payout", "Flatpay-Auszahlung", "1200", "transfer", "transfer", "cardPayout", true, false, 0, "1360", "Kartenerlöse werden aus dem Geldtransit auf das Bankkonto umgebucht.");
  }
  if (includesAny(value, ["bargeldeinzahlung sb", "sb einzahlung"])) {
    return { ...rule("cash-deposit", "Kasse an Bank", "1200", "transfer", "transfer", "cashDeposit", true, false, 0, "1000", "Bareinzahlung wird als Kasse-an-Bank-Umbuchung gebucht."), cashEffect: "deposit" };
  }
  if (amount < 0 && value.includes("paypal europe")) {
    return rule("paypal-funding", "Bank an PayPal", "1370", "transfer", "transfer", "paypalFunding", true, false, 0, "1200", "Die Bankbelastung finanziert PayPal; der eigentliche Einkauf kommt aus dem PayPal-Bericht.");
  }
  if (includesAny(value, ["kontoführung", "kontofuehrung", "abrechnung", "bankentgelt"]) && amount < 0) {
    return rule("bank-fee", "Bankgebühren", "4970", "expense", "expense", "bankFee", false, false, 0, "1200", "Bankentgelte werden ohne Vorsteuer gebucht.");
  }
  if (amount < 0 && value.includes("gulbahar sun")) {
    return rule("family-payment", "Familienzahlung / privat", "1800", "transfer", "private", "privateWithdrawal", true, false, 0, "1200", "Zahlung an Gülbahar Sun wird als private Familienzahlung behandelt.");
  }
  if (amount < 0 && value.includes("murat toere") && value.includes("gehalt")) {
    return rule("murat-salary", "Mitarbeitergehalt Murat Toere", "4120", "expense", "expense", "salary", false, false, 0, "1200", "Mitarbeitergehalt wird automatisch als Personalaufwand gebucht.");
  }
  if (amount < 0 && includesAny(value, ["aok nordwest", "gesundheitskasse"])) {
    return rule("owner-health", "Private Krankenversicherung des Inhabers", "1800", "transfer", "private", "privateWithdrawal", true, false, 0, "1200", "AOK-Zahlung des Inhabers wird als Privatentnahme behandelt.");
  }
  if (amount < 0 && value.includes("ikk classic")) {
    return rule("employee-social", "Sozialversicherung Mitarbeiter", "4130", "expense", "expense", "socialInsurance", false, false, 0, "1200", "IKK-Beitrag wird als gesetzlicher Sozialaufwand für Mitarbeiter gebucht.");
  }
  if (amount < 0 && includesAny(value, ["miete", "betriebskosten"])) {
    return rule("rent", "Miete und Betriebskosten", "4210", "expense", "expense", "rent", false, false, 0, "1200", "Miete und Nebenkosten werden automatisch gebucht.");
  }
  if (amount < 0 && includesAny(value, ["unitel", "guthaben auflade", "guthabenauflade", "aufladekarte"])) {
    return rule("unitel-clearing", "UniTel Guthaben-Verrechnung", "1590", "transfer", "transfer", "expense", true, false, 0, "1200", "Der Guthaben-Nennwert ist ein durchlaufender Posten; nur die Provision ist Ertrag.");
  }
  if (amount > 0 && value.includes("unitel") && includesAny(value, ["provision", "vertrag", "gutschrift", "abrechnung"])) {
    return rule("unitel-commission", "UniTel Provision", "8403", "income", "income", "income", false, true, 19, "1200", "UniTel- oder Vertragsprovision; Abrechnungsbeleg für die Umsatzsteuer zuordnen.");
  }
  if (amount < 0 && value.includes("prifoto")) {
    return rule("prifoto-clearing", "Prifoto 50/50-Verrechnung", "1592", "transfer", "transfer", "expense", true, false, 0, "1200", "Zahlung des Prifoto-Anteils wird gegen das Prifoto-Verrechnungskonto gebucht.");
  }
  if (amount > 0 && value.includes("prifoto")) {
    return rule("prifoto-commission", "Prifoto Eigenanteil / Provision", "8401", "income", "income", "income", false, true, 19, "1200", "Prifoto-Eigenanteil wird als Provision gebucht; Abrechnung zuordnen.");
  }
  if (amount > 0 && includesAny(value, ["telefonica sagt danke", "ortel sagt danke", "dpd deutschland"])) {
    return rule("partner-commission", "Partnerprovision", "8403", "income", "income", "income", false, true, 19, "1200", "Telefonica-, Ortel- oder DPD-Gutschrift wird als Provision gebucht; Gutschrift/Abrechnung zuordnen.");
  }
  if (amount > 0 && value.includes("google ireland")) {
    return rule("google-adsense", "Google AdSense EU-Dienstleistung", "8338", "income", "income", "income", false, true, 0, "1200", "Google-AdSense-Ertrag als EU-Dienstleistung; Abrechnung für die umsatzsteuerliche Einordnung zuordnen.");
  }
  if (amount < 0 && includesAny(value, ["aswo", "otara", "mastrade", "mas trade", "atelcom", "@telcom", "ebay", "amazon", "aliexpress", "media markt", "mediamarkt"])) {
    return rule("parts-supplier", "Telefonteile und Reparaturmaterial", "3400", "expense", "expense", "expense", false, true, 19, "1200", "Lieferant für Telefon-, Ersatzteil- oder Reparaturmaterial; Rechnung für Vorsteuer zuordnen.");
  }
  if (amount < 0 && value.includes("tchibo")) {
    return rule("refreshments", "Kaffee und Mitarbeiterbewirtung", "4140", "expense", "expense", "expense", false, true, 19, "1200", "Standardmäßig Kaffee/Mitarbeiterbewirtung; bei Handelsware kann der Beleg auf Wareneinkauf umgestellt werden.");
  }
  if (amount < 0 && includesAny(value, ["mark e", "strom", "energie"])) {
    return rule("energy", "Strom und Energie", "4240", "expense", "expense", "expense", false, true, 19, "1200", "Energieaufwand; Rechnung für Vorsteuer zuordnen.");
  }
  if (amount < 0 && includesAny(value, ["telefonica germany", "tarifrechnung"])) {
    return rule("phone-internet", "Telefon und Internet", "4920", "expense", "expense", "expense", false, true, 19, "1200", "Telefon-/Internetaufwand; Rechnung für Vorsteuer zuordnen.");
  }

  return undefined;
}

export function resolveConfiguredKasRule(input: KasRuleInput): ConfiguredKasRule | undefined {
  const value = normalizeRuleText(input.description);
  const code = input.categoryCode;

  if (code === 1590 || value.includes("unitel guthaben")) {
    return kasRule("1590", "transfer", "transfer", 0, "UniTel-Guthaben wird als durchlaufender Posten gegen die Kasse gebucht.");
  }
  if (code === 8401 && value.includes("prifoto")) {
    return kasRule("1592", "transfer", "transfer", 0, "Prifoto-Kundengeld wird bis zur 50/50-Abrechnung auf dem Verrechnungskonto geführt.");
  }
  if (code === 1591 || code === 15911 || includesAny(value, ["ria money transfer", "ria auszahlung", "moneygram", "money gram"])) {
    return kasRule("1591", "transfer", "transfer", 0, "Ria/MoneyGram-Nennbeträge sind durchlaufende Posten und kein eigener Umsatz.");
  }
  if (code === 1360 || code === 1200) {
    return kasRule(String(code), "transfer", "transfer", 0, "Kasse/Bank/Geldtransit-Umbuchung.");
  }
  if (code === 1800 || value.includes("privat")) {
    return kasRule("1800", "transfer", "private", 0, "Private Zahlung des Einzelunternehmers.");
  }
  if (code === 1890) {
    return kasRule("1890", "transfer", "private", 0, "Privateinlage des Einzelunternehmers.");
  }
  if (code === 0 && includesAny(value, ["lyca", "lycatel"])) {
    return kasRule("3430", input.signedAmount < 0 ? "expense" : "income", input.signedAmount < 0 ? "expense" : "income", input.taxRate === 7 ? 7 : 19, "Lyca-/SIM-Karten-Vorgang.");
  }
  if (code === 0 && includesAny(value, ["aswo", "otara", "mastrade", "mas trade", "atelcom", "@telcom", "ebay", "amazon", "aliexpress", "media markt", "mediamarkt"])) {
    return kasRule("3400", input.signedAmount < 0 ? "expense" : "income", input.signedAmount < 0 ? "expense" : "income", input.taxRate === 7 ? 7 : 19, "Telefonteile und Reparaturmaterial.");
  }
  if (code === 0 && value.includes("unitel")) {
    return kasRule("1590", "transfer", "transfer", 0, "UniTel-Verrechnung gegen die Kasse.");
  }

  return undefined;
}

export function applyConfiguredBusinessRules(current: AppState): AppState {
  const bankAllocator = createPeriodBookingNumberAllocator("BANK", current.ledger);
  const transferAllocator = createPeriodBookingNumberAllocator("UMB", current.ledger);
  const cashAllocator = createPeriodBookingNumberAllocator("KASSE", current.ledger);
  const ledgerById = new Map(current.ledger.map((entry) => [entry.id, entry]));
  let changed = false;

  const importedTransactions = current.importedTransactions.map((transaction) => {
    if (transaction.accountType !== "bank" || !transaction.matchedLedgerEntryId) return transaction;
    const entry = ledgerById.get(transaction.matchedLedgerEntryId);
    if (!entry || entry.source !== "bankImport") return transaction;
    const ruleResult = resolveConfiguredBankRule(`${transaction.counterparty || ""} ${transaction.description}`, transaction.amount);
    const numberAllocator = ruleResult?.internalTransfer || entry.direction === "transfer" ? transferAllocator : bankAllocator;
    const bookingNumber = validPeriodBookingNumber(entry.documentNumber)
      ? entry.documentNumber
      : numberAllocator(entry.date);

    let nextEntry: LedgerEntry = bookingNumber === entry.documentNumber ? entry : { ...entry, documentNumber: bookingNumber };
    let nextTransaction = transaction;

    if (ruleResult) {
      const account = getBookingCategory(ruleResult.accountCode);
      const notePart = `${ruleResult.explanation}${ruleResult.documentRequired && ruleResult.recommendedTaxRate ? ` Erwarteter Steuersatz laut Beleg: ${ruleResult.recommendedTaxRate} %.` : ""}`;
      nextEntry = {
        ...nextEntry,
        direction: ruleResult.direction,
        paymentMethod: "bank",
        description: ruleResult.label,
        category: `${ruleResult.accountCode} · ${account?.label || ruleResult.label}`,
        accountCode: ruleResult.accountCode,
        counterAccountCode: ruleResult.counterAccountCode,
        taxRate: 0,
        taxAmount: 0,
        taxMode: "taxFree",
        netAmount: Math.abs(transaction.amount),
        cashChange: ruleResult.cashEffect === "deposit" ? -Math.abs(transaction.amount) : 0,
        reconciled: !ruleResult.documentRequired,
        manualKind: ruleResult.manualKind,
        note: appendNote(nextEntry.note, notePart),
      };
      nextTransaction = {
        ...transaction,
        suggestedAccountCode: ruleResult.accountCode,
        status: ruleResult.internalTransfer ? "ignored" : ruleResult.documentRequired ? "needsReview" : "matched",
        bookkeepingStatus: ruleResult.documentRequired ? "booked" : "reviewed",
      };
    }

    if (!sameLedgerEntry(entry, nextEntry)) {
      ledgerById.set(entry.id, nextEntry);
      changed = true;
    }
    if (!sameImportedTransaction(transaction, nextTransaction)) changed = true;
    return nextTransaction;
  });

  const ledger = current.ledger.map((entry) => {
    let next = ledgerById.get(entry.id) || entry;
    if (next.source === "kasImport") {
      const signedAmount = typeof next.cashChange === "number"
        ? next.cashChange
        : next.direction === "expense" ? -next.amount : next.amount;
      const kasRuleResult = resolveConfiguredKasRule({
        categoryCode: Number(next.accountCode || 0),
        description: next.description,
        signedAmount,
        taxRate: next.taxRate,
      });
      const bookingNumber = validPeriodBookingNumber(next.documentNumber)
        ? next.documentNumber
        : cashAllocator(next.date);
      if (kasRuleResult) {
        const account = getBookingCategory(kasRuleResult.accountCode);
        next = {
          ...next,
          documentNumber: bookingNumber,
          direction: kasRuleResult.direction,
          category: `${kasRuleResult.accountCode} · ${account?.label || "Betriebliche Zuordnung"}`,
          accountCode: kasRuleResult.accountCode,
          counterAccountCode: "1000",
          taxRate: kasRuleResult.taxRate,
          taxAmount: kasRuleResult.taxRate ? includedTax(next.amount, kasRuleResult.taxRate) : 0,
          taxMode: kasRuleResult.taxRate ? "standard19" : "taxFree",
          netAmount: roundMoney(next.amount - (kasRuleResult.taxRate ? includedTax(next.amount, kasRuleResult.taxRate) : 0)),
          reconciled: true,
          manualKind: kasRuleResult.manualKind,
          note: appendNote(next.note, kasRuleResult.explanation),
        };
      } else if (bookingNumber !== next.documentNumber) {
        next = { ...next, documentNumber: bookingNumber };
      }
    }
    if (!sameLedgerEntry(entry, next)) changed = true;
    return next;
  });

  return changed ? { ...current, ledger, importedTransactions } : current;
}

export function createPeriodBookingNumberAllocator(prefix: string, entries: Array<Pick<LedgerEntry, "documentNumber">>) {
  const normalizedPrefix = prefix.toUpperCase();
  const counters = new Map<string, number>();
  const pattern = new RegExp(`^${escapeRegExp(normalizedPrefix)}-(\\d{6})-(\\d{4})$`);
  for (const entry of entries) {
    const match = entry.documentNumber?.match(pattern);
    if (!match) continue;
    counters.set(match[1], Math.max(counters.get(match[1]) || 0, Number(match[2])));
  }
  return (date: string) => {
    const period = date.slice(0, 7).replace("-", "");
    const next = (counters.get(period) || 0) + 1;
    counters.set(period, next);
    return `${normalizedPrefix}-${period}-${String(next).padStart(4, "0")}`;
  };
}

export function validPeriodBookingNumber(value?: string): boolean {
  return /^(?:BANK|UMB|KASSE)-\d{6}-\d{4}$/.test(value || "");
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

function rule(
  key: string,
  label: string,
  accountCode: string,
  direction: LedgerDirection,
  manualKind: ManualKind,
  classification: ConfiguredBankClassification,
  internalTransfer: boolean,
  documentRequired: boolean,
  recommendedTaxRate: 0 | 7 | 19,
  counterAccountCode: string,
  explanation: string,
): ConfiguredBusinessRule {
  return { key, label, accountCode, direction, manualKind, classification, internalTransfer, documentRequired, recommendedTaxRate, counterAccountCode, explanation };
}

function kasRule(
  accountCode: string,
  direction: LedgerDirection,
  manualKind: ManualKind,
  taxRate: 0 | 7 | 19,
  explanation: string,
): ConfiguredKasRule {
  return { accountCode, direction, manualKind, taxRate, explanation };
}

function includesAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(normalizeRuleText(term)));
}

function appendNote(current: string | undefined, addition: string): string {
  if (!current) return addition;
  return current.includes(addition) ? current : `${current} · ${addition}`;
}

function includedTax(gross: number, rate: number): number {
  return roundMoney((gross * rate) / (100 + rate));
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function sameLedgerEntry(left: LedgerEntry, right: LedgerEntry): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameImportedTransaction(left: AppState["importedTransactions"][number], right: AppState["importedTransactions"][number]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
