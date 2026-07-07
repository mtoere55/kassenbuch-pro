import { useEffect, useState } from "react";
import type {
  AppState,
  BusinessDocument,
  LedgerDirection,
  LedgerEntry,
  TaxMode,
} from "./types";

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

export interface RecordControlConfig {
  startDate: string;
  prefix: string;
  startNumber: number;
  lockChanges: boolean;
  accessHash: string;
}

type NumberedDocument = BusinessDocument & { officialRecordNumber?: string };
type NumberedLedgerEntry = LedgerEntry & { officialRecordNumber?: string };

const CONTROL_STORAGE_KEY = "kassenbuch-pro-record-control-v1";
const ACCESS_SESSION_KEY = "kassenbuch-pro-service-access-v1";
const ACCESS_EVENT = "kassenbuch-pro-service-access-change";

export const DEFAULT_RECORD_CONTROL: RecordControlConfig = {
  startDate: "2026-07-01",
  prefix: "KB",
  startNumber: 700001,
  lockChanges: true,
  accessHash: "",
};

export function loadRecordControl(): RecordControlConfig {
  if (typeof window === "undefined") return DEFAULT_RECORD_CONTROL;
  try {
    const stored = window.localStorage.getItem(CONTROL_STORAGE_KEY);
    if (!stored) return DEFAULT_RECORD_CONTROL;
    const parsed = JSON.parse(stored) as Partial<RecordControlConfig>;
    return {
      ...DEFAULT_RECORD_CONTROL,
      ...parsed,
      prefix: String(parsed.prefix || DEFAULT_RECORD_CONTROL.prefix).toUpperCase(),
      startNumber: Number(parsed.startNumber || DEFAULT_RECORD_CONTROL.startNumber),
    };
  } catch {
    return DEFAULT_RECORD_CONTROL;
  }
}

export function saveRecordControl(config: RecordControlConfig): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CONTROL_STORAGE_KEY, JSON.stringify(config));
  window.dispatchEvent(new Event(ACCESS_EVENT));
}

export function isServiceAccessOpen(): boolean {
  return typeof window !== "undefined" && window.sessionStorage.getItem(ACCESS_SESSION_KEY) === "1";
}

export function closeServiceAccess(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(ACCESS_SESSION_KEY);
  window.dispatchEvent(new Event(ACCESS_EVENT));
}

export function requestServiceAccess(): boolean {
  if (typeof window === "undefined") return false;
  const config = loadRecordControl();
  if (!config.accessHash) {
    const first = window.prompt("Service-Code neu festlegen (mindestens 4 Zeichen):");
    if (!first || first.length < 4) return false;
    const second = window.prompt("Service-Code wiederholen:");
    if (first !== second) {
      window.alert("Die Eingaben stimmen nicht überein.");
      return false;
    }
    saveRecordControl({ ...config, accessHash: localCodeHash(first) });
  } else {
    const value = window.prompt("Service-Code:");
    if (!value || localCodeHash(value) !== config.accessHash) {
      window.alert("Service-Code ist nicht korrekt.");
      return false;
    }
  }
  window.sessionStorage.setItem(ACCESS_SESSION_KEY, "1");
  window.dispatchEvent(new Event(ACCESS_EVENT));
  return true;
}

export function updateServiceCode(): boolean {
  if (typeof window === "undefined" || !isServiceAccessOpen()) return false;
  const first = window.prompt("Neuen Service-Code eingeben (mindestens 4 Zeichen):");
  if (!first || first.length < 4) return false;
  const second = window.prompt("Neuen Service-Code wiederholen:");
  if (first !== second) {
    window.alert("Die Eingaben stimmen nicht überein.");
    return false;
  }
  saveRecordControl({ ...loadRecordControl(), accessHash: localCodeHash(first) });
  return true;
}

export function useServiceAccess() {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<RecordControlConfig>(DEFAULT_RECORD_CONTROL);

  useEffect(() => {
    const refresh = () => {
      setOpen(isServiceAccessOpen());
      setConfig(loadRecordControl());
    };
    refresh();
    window.addEventListener(ACCESS_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(ACCESS_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return { open, config };
}

export function isChangeAllowed(date: string, serviceOpen = isServiceAccessOpen()): boolean {
  const config = loadRecordControl();
  if (!config.lockChanges) return true;
  if (!date || date < config.startDate) return true;
  return serviceOpen;
}

export function officialRecordNumber(value: BusinessDocument | LedgerEntry): string | undefined {
  return (value as NumberedDocument | NumberedLedgerEntry).officialRecordNumber ||
    ("metadata" in value ? String(value.metadata?.officialRecordNumber || "") || undefined : undefined);
}

export function applyOfficialRecordNumbers(state: AppState): AppState {
  const config = loadRecordControl();
  const documents = state.documents as NumberedDocument[];
  const ledger = state.ledger as NumberedLedgerEntry[];
  const existing = [...documents, ...ledger]
    .map((item) => item.officialRecordNumber)
    .filter((value): value is string => Boolean(value));
  let next = Math.max(
    config.startNumber - 1,
    ...existing.map((value) => parseRecordSequence(value)).filter(Number.isFinite),
  ) + 1;

  const groups = new Map<string, {
    date: string;
    createdAt: string;
    documentIds: string[];
    ledgerIds: string[];
  }>();

  for (const document of documents) {
    if (document.date < config.startDate || document.officialRecordNumber) continue;
    const key = `document:${document.id}`;
    groups.set(key, {
      date: document.date,
      createdAt: document.createdAt,
      documentIds: [document.id],
      ledgerIds: ledger.filter((entry) => entry.documentId === document.id).map((entry) => entry.id),
    });
  }
  for (const entry of ledger) {
    if (entry.date < config.startDate || entry.officialRecordNumber) continue;
    if (entry.documentId && documents.some((document) => document.id === entry.documentId)) continue;
    const key = entry.groupId || entry.sourceId || entry.id;
    const group = groups.get(key) || {
      date: entry.date,
      createdAt: entry.createdAt,
      documentIds: [],
      ledgerIds: [],
    };
    group.ledgerIds.push(entry.id);
    groups.set(key, group);
  }

  if (!groups.size) return state;
  const documentNumbers = new Map<string, string>();
  const ledgerNumbers = new Map<string, string>();
  [...groups.values()]
    .sort((left, right) => `${left.date}|${left.createdAt}`.localeCompare(`${right.date}|${right.createdAt}`))
    .forEach((group) => {
      const number = `${config.prefix}-${String(next).padStart(6, "0")}`;
      next += 1;
      group.documentIds.forEach((id) => documentNumbers.set(id, number));
      group.ledgerIds.forEach((id) => ledgerNumbers.set(id, number));
    });

  return {
    ...state,
    documents: documents.map((document) => {
      const number = documentNumbers.get(document.id);
      if (!number) return document;
      return {
        ...document,
        officialRecordNumber: number,
        metadata: {
          ...(document.metadata || {}),
          officialRecordNumber: number,
          officialStartDate: config.startDate,
        },
      };
    }),
    ledger: ledger.map((entry) => {
      const number = ledgerNumbers.get(entry.id);
      return number ? { ...entry, officialRecordNumber: number } : entry;
    }),
  };
}

function parseRecordSequence(value: string): number {
  const match = value.match(/(\d+)$/);
  return match ? Number(match[1]) : Number.NaN;
}

function localCodeHash(value: string): string {
  let hash = 2166136261;
  const salted = `kassenbuch-pro:${value}`;
  for (let index = 0; index < salted.length; index += 1) {
    hash ^= salted.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
