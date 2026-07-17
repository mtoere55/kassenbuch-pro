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
      return modelPrifotoEntry(entry, originalReference, originalNote);
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

function modelPrifotoEntry(entry: LedgerEntry, documentNumber: string | undefined, originalNote: string): LedgerEntry[] {
  const fullCash = roundMoney(entry.amount);
  const ownShare = roundMoney(fullCash / 2);
  const taxAmount = getTaxAmountFromGross(ownShare, 19);
  const groupId = entry.groupId || entry.sourceId || entry.id;
  const sharedNote = appendNote(
    appendNote(entry.note, originalNote),
    "Prifoto-Clearingmodell v2: vollständiger Kundenbetrag in Kasse 1000; Eigenanteil intern von 1592 auf 8401 umgebucht.",
  );

  const cashReceipt: LedgerEntry = {
    ...entry,
    amount: fullCash,
    direction: "transfer",
    description: "Prifoto Tagesverkauf bar / Gesamtbetrag",
    category: "1592 · Durchlaufende Posten / Prifoto",
    accountCode: "1592",
    counterAccountCode: "1000",
    taxAmount: 0,
    taxRate: 0,
    taxMode: "taxFree",
    netAmount: fullCash,
    cashChange: entry.cashChange || fullCash,
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
    description: "Prifoto Eigenanteil / interne Umbuchung",
    category: "8401 · Erlöse 19 Prozent / Prifoto Eigenanteil",
    accountCode: "8401",
    counterAccountCode: "1592",
    taxAmount,
    taxRate: 19,
    taxMode: "standard19",
    netAmount: roundMoney(ownShare - taxAmount),
    cashChange: 0,
    documentNumber,
    groupId,
    manualKind: "income",
    reconciled: true,
    note: sharedNote,
  };

  return [cashReceipt, commission];
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
