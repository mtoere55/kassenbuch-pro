import { getBookingCategory } from "./accounts";
import type { LedgerEntry } from "./types";

export function normalizeMeinbuchImportEntries(entries: LedgerEntry[]): LedgerEntry[] {
  return entries.map((entry) => {
    if (entry.source !== "kasImport") return entry;
    const recordId = entry.sourceId?.match(/:(\d+)$/)?.[1];
    const mapped = entry.accountCode === "0000" ? mapLegacyMerchant(entry.description) : undefined;
    const accountCode = mapped?.accountCode || entry.accountCode || "0000";
    const account = getBookingCategory(accountCode);
    return {
      ...entry,
      documentNumber: recordId ? `KAS-${recordId}` : entry.documentNumber,
      accountCode,
      category: mapped ? `${accountCode} · ${account?.label || mapped.label}` : entry.category,
      reconciled: accountCode !== "0000",
      note: appendNote(
        entry.note,
        recordId ? `MeinBuch-Originaldatensatz ${recordId}; Datum, Text, Betrag und Vorzeichen unverändert übernommen.` : "MeinBuch-Datensatz unverändert übernommen.",
      ),
    };
  });
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
