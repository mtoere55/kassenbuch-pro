import { getTaxAmountFromGross } from "./accounting";
import { getBookingCategory } from "./accounts";
import type { LedgerEntry } from "./types";

export function normalizeMeinbuchImportEntries(entries: LedgerEntry[]): LedgerEntry[] {
  return entries.flatMap((entry) => {
    if (entry.source !== "kasImport") return [entry];
    const recordId = entry.sourceId?.match(/:(\d+)$/)?.[1];
    const originalReference = recordId ? `KAS-${recordId}` : entry.documentNumber;
    const originalNote = recordId
      ? `MeinBuch-Originaldatensatz ${recordId}; Datum, Text, Betrag und Vorzeichen unverändert übernommen.`
      : "MeinBuch-Datensatz unverändert übernommen.";

    if (isPrifotoReceipt(entry)) {
      return splitPrifotoEntry(entry, originalReference, originalNote);
    }

    const mapped = entry.accountCode === "0000" ? mapLegacyMerchant(entry.description) : undefined;
    const accountCode = mapped?.accountCode || entry.accountCode || "0000";
    const account = getBookingCategory(accountCode);
    return [{
      ...entry,
      documentNumber: originalReference,
      accountCode,
      category: mapped ? `${accountCode} · ${account?.label || mapped.label}` : entry.category,
      reconciled: accountCode !== "0000",
      note: appendNote(entry.note, originalNote),
    }];
  });
}

function splitPrifotoEntry(entry: LedgerEntry, documentNumber: string | undefined, originalNote: string): LedgerEntry[] {
  const ownShare = roundMoney(entry.amount / 2);
  const partnerShare = roundMoney(entry.amount - ownShare);
  const originalCashChange = entry.cashChange || 0;
  const ownCashChange = roundMoney(originalCashChange / 2);
  const partnerCashChange = roundMoney(originalCashChange - ownCashChange);
  const taxAmount = getTaxAmountFromGross(ownShare, 19);
  const groupId = entry.groupId || entry.sourceId || entry.id;
  const sharedNote = appendNote(
    appendNote(entry.note, originalNote),
    "Historischer Prifoto-Vorgang nach Geschäftsregel 50/50 auf Prifoto-Verrechnung und eigenen Provisionserlös verteilt.",
  );

  const clearing: LedgerEntry = {
    ...entry,
    amount: partnerShare,
    direction: "transfer",
    description: "Prifoto Fremdanteil / Verrechnung",
    category: "1592 · Durchlaufende Posten / Prifoto",
    accountCode: "1592",
    taxAmount: 0,
    taxRate: 0,
    taxMode: "taxFree",
    netAmount: partnerShare,
    cashChange: partnerCashChange,
    documentNumber,
    groupId,
    manualKind: "transfer",
    reconciled: true,
    note: sharedNote,
  };

  const commission: LedgerEntry = {
    ...entry,
    id: `${entry.id}-prifoto-provision`,
    sourceId: entry.sourceId ? `${entry.sourceId}:prifoto-provision` : undefined,
    amount: ownShare,
    direction: "income",
    description: "Prifoto Eigenanteil / Provision",
    category: "8401 · Erlöse 19 Prozent / Prifoto Eigenanteil",
    accountCode: "8401",
    taxAmount,
    taxRate: 19,
    taxMode: "standard19",
    netAmount: roundMoney(ownShare - taxAmount),
    cashChange: ownCashChange,
    documentNumber,
    groupId,
    manualKind: "income",
    reconciled: true,
    note: sharedNote,
  };

  return [clearing, commission];
}

function isPrifotoReceipt(entry: LedgerEntry): boolean {
  return entry.accountCode === "1592" && /prifoto/i.test(entry.description) && entry.direction === "transfer" && entry.amount > 0;
}

function mapLegacyMerchant(description: string): { accountCode: string; label: string } | undefined {
  const value = normalize(description);
  if (/laycatel|lycatel|lyca|@\.?tel\.?com/.test(value)) {
    return { accountCode: "3430", label: "SIM- und Guthabenkarten-Einkauf" };
  }
  if (/\baction\b|\bmuller\b|\bnetto\b|hagenerstrassen bahn/.test(value)) {
    return { accountCode: "4980", label: "Sonstiger Betriebsbedarf" };
  }
  return undefined;
}

function normalize(value: string): string {
  return value.toLowerCase().replaceAll("ü", "u").replaceAll("ö", "o").replaceAll("ä", "a").replaceAll("ß", "ss").replace(/\s+/g, " ").trim();
}

function appendNote(current: string | undefined, addition: string): string {
  if (!current) return addition;
  return current.includes(addition) ? current : `${current} · ${addition}`;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
