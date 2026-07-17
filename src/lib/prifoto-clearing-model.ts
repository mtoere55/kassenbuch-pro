import { getTaxAmountFromGross, makeId } from "./accounting";
import { createPeriodBookingNumberAllocator } from "./business-booking-rules";
import type {
  PrifotoCashConflict,
  PrifotoCashReport,
  PrifotoDailySale,
  PrifotoPartialDay,
} from "./prifoto-cash-import";
import type { AppState, BusinessDocument, LedgerEntry } from "./types";

const TOLERANCE = 0.02;
const MODEL_MARKER = "Prifoto-Clearingmodell v2";

export interface PrifotoCashImportPlanV2 {
  document: BusinessDocument;
  entries: LedgerEntry[];
  importedDays: number;
  importedCash: number;
  skippedExistingDays: number;
  partialDays: PrifotoPartialDay[];
  conflicts: PrifotoCashConflict[];
  totalCash: number;
  partnerShare: number;
  ownShare: number;
  ownVat: number;
}

interface ExistingPrifotoDay {
  cashTotal: number;
  ownGross: number;
  ownVat: number;
}

interface ImportDay {
  day: PrifotoDailySale;
  remainingCash: number;
  remainingOwn: number;
  existingCash: number;
}

export function createPrifotoCashImportPlanV2(
  current: AppState,
  report: PrifotoCashReport,
  fileName: string,
  fileDataUrl?: string,
): PrifotoCashImportPlanV2 {
  const duplicate = current.documents.find((document) =>
    document.metadata?.prifotoFingerprint === report.fingerprint ||
    (document.metadata?.provider === "Prifoto" && document.documentNumber === report.invoiceNumber),
  );
  if (duplicate) throw new Error(`Dieser Prifoto-Bericht wurde bereits als ${duplicate.documentNumber} importiert.`);

  const normalizedLedger = migrateLegacyPrifotoLedgerEntries(current.ledger);
  const existingByDate = existingPrifotoByDate(normalizedLedger);
  const partialDays: PrifotoPartialDay[] = [];
  const conflicts: PrifotoCashConflict[] = [];
  const importDays: ImportDay[] = [];
  let skippedExistingDays = 0;
  let existingOwnVat = 0;

  for (const day of report.days) {
    const existing = existingByDate.get(day.date) || emptyExistingDay();
    const target = splitDay(day);
    const remainingCash = roundMoney(day.amount - existing.cashTotal);
    const remainingOwn = roundMoney(target.ownShare - existing.ownGross);

    if (remainingCash < -TOLERANCE || remainingOwn < -TOLERANCE) {
      conflicts.push({
        date: day.date,
        reportTotal: day.amount,
        existingTotal: existing.cashTotal,
        difference: remainingCash,
      });
      continue;
    }

    existingOwnVat = roundMoney(existingOwnVat + existing.ownVat);
    if (close(remainingCash, 0) && close(remainingOwn, 0)) {
      skippedExistingDays += 1;
      continue;
    }

    if (existing.cashTotal > TOLERANCE || existing.ownGross > TOLERANCE) {
      partialDays.push({
        date: day.date,
        reportTotal: day.amount,
        existingTotal: existing.cashTotal,
        remainingTotal: Math.max(0, remainingCash),
      });
    }

    importDays.push({
      day,
      remainingCash: Math.max(0, remainingCash),
      remainingOwn: Math.max(0, remainingOwn),
      existingCash: existing.cashTotal,
    });
  }

  const documentId = makeId("document");
  const createdAt = new Date().toISOString();
  const allocateCashNumber = createPeriodBookingNumberAllocator("KASSE", normalizedLedger);
  const entries: LedgerEntry[] = [];
  const reportSplits = report.days.map(splitDay);
  const partnerShare = roundMoney(reportSplits.reduce((sum, split) => sum + split.partnerShare, 0));
  const ownShare = roundMoney(reportSplits.reduce((sum, split) => sum + split.ownShare, 0));
  const ownVat = getTaxAmountFromGross(ownShare, 19);
  const importedVatTarget = Math.max(0, roundMoney(ownVat - existingOwnVat));
  let cumulativeOwnGross = 0;
  let cumulativeOwnVat = 0;
  let revenueEntryIndex = 0;
  const revenueEntryCount = importDays.filter((item) => item.remainingOwn > TOLERANCE).length;

  for (const item of importDays) {
    const bookingNumber = allocateCashNumber(item.day.date);
    const groupId = `${report.fingerprint}:${item.day.date}`;
    const completionNote = item.existingCash > TOLERANCE
      ? ` Bereits bar erfasst ${money(item.existingCash)}; Kasse wird nur um ${money(item.remainingCash)} ergänzt.`
      : "";
    const sharedNote = `${report.invoiceNumber} · ${item.day.orders} Bestellung(en) · vollständiger Barverkauf in Kasse 1000; anschließend 50 Prozent Eigenanteil intern von 1592 auf 8401 umgebucht. ${MODEL_MARKER}.${completionNote}`;

    if (item.remainingCash > TOLERANCE) {
      entries.push({
        id: makeId("ledger"),
        date: item.day.date,
        direction: "transfer",
        amount: item.remainingCash,
        paymentMethod: "cash",
        description: item.existingCash > TOLERANCE
          ? "Prifoto Tagesverkauf bar / Restbetrag"
          : "Prifoto Tagesverkauf bar / Gesamtbetrag",
        category: "1592 · Durchlaufende Posten / Prifoto",
        source: "prifotoImport",
        sourceId: `prifoto-sales:${report.fingerprint}:${item.day.date}:cash`,
        documentId,
        taxAmount: 0,
        taxRate: 0,
        taxMode: "taxFree",
        reconciled: true,
        accountCode: "1592",
        counterAccountCode: "1000",
        documentNumber: bookingNumber,
        groupId,
        cashChange: item.remainingCash,
        netAmount: item.remainingCash,
        attachmentFileName: fileName,
        attachmentDataUrl: fileDataUrl,
        note: sharedNote,
        manualKind: "transfer",
        createdAt,
      });
    }

    if (item.remainingOwn > TOLERANCE) {
      revenueEntryIndex += 1;
      cumulativeOwnGross = roundMoney(cumulativeOwnGross + item.remainingOwn);
      const standardCumulativeVat = getTaxAmountFromGross(cumulativeOwnGross, 19);
      let entryVat = roundMoney(standardCumulativeVat - cumulativeOwnVat);
      if (revenueEntryIndex === revenueEntryCount) {
        entryVat = roundMoney(entryVat + importedVatTarget - (cumulativeOwnVat + entryVat));
      }
      entryVat = Math.max(0, entryVat);
      cumulativeOwnVat = roundMoney(cumulativeOwnVat + entryVat);

      entries.push({
        id: makeId("ledger"),
        date: item.day.date,
        direction: "income",
        amount: item.remainingOwn,
        paymentMethod: "cash",
        description: item.existingCash > TOLERANCE
          ? "Prifoto Eigenanteil / interne Restumbuchung"
          : "Prifoto Eigenanteil / interne Umbuchung",
        category: "8401 · Erlöse 19 Prozent / Prifoto Eigenanteil",
        source: "prifotoImport",
        sourceId: `prifoto-sales:${report.fingerprint}:${item.day.date}:own`,
        documentId,
        taxAmount: entryVat,
        taxRate: 19,
        taxMode: "standard19",
        reconciled: true,
        accountCode: "8401",
        counterAccountCode: "1592",
        documentNumber: bookingNumber,
        groupId,
        cashChange: 0,
        netAmount: roundMoney(item.remainingOwn - entryVat),
        attachmentFileName: fileName,
        attachmentDataUrl: fileDataUrl,
        note: sharedNote,
        manualKind: "income",
        createdAt,
      });
    }
  }

  const importedCash = roundMoney(importDays.reduce((sum, item) => sum + item.remainingCash, 0));
  const document: BusinessDocument = {
    id: documentId,
    documentNumber: report.invoiceNumber,
    type: "zReport",
    date: report.invoiceDate,
    amount: report.total,
    taxAmount: ownVat,
    taxMode: "standard19",
    paymentMethod: "cash",
    status: "archived",
    originalFileName: fileName,
    originalImageDataUrl: fileDataUrl,
    ocrText: report.sourceText,
    metadata: {
      provider: "Prifoto",
      reportKind: "Tagesverkäufe Vollkasse mit 50/50-Clearing",
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      salesDayCount: report.salesDayCount,
      orderCount: report.orderCount,
      totalCash: report.total,
      importedCash,
      partnerShare,
      ownShare,
      ownVat,
      productTotal: report.productTotal ?? null,
      productDifference: report.productDifference ?? null,
      paymentAllocation: "full-cash-then-internal-clearing",
      prifotoFingerprint: report.fingerprint,
      prifotoModel: "v2-full-cash-clearing",
      importedDays: importDays.length,
      partialDays: partialDays.length,
      skippedExistingDays,
      conflictDays: conflicts.length,
      internallyValidated: true,
    },
    createdAt,
  };

  return {
    document,
    entries,
    importedDays: importDays.length,
    importedCash,
    skippedExistingDays,
    partialDays,
    conflicts,
    totalCash: report.total,
    partnerShare,
    ownShare,
    ownVat,
  };
}

export function migrateLegacyPrifotoState(state: AppState): AppState {
  const ledger = migrateLegacyPrifotoLedgerEntries(state.ledger);
  return ledger === state.ledger ? state : { ...state, ledger };
}

export function migrateLegacyPrifotoLedgerEntries(entries: LedgerEntry[]): LedgerEntry[] {
  const groups = new Map<string, LedgerEntry[]>();
  for (const entry of entries) {
    if (!isPrifotoEntry(entry) || !entry.groupId) continue;
    groups.set(entry.groupId, [...(groups.get(entry.groupId) || []), entry]);
  }

  const replacements = new Map<string, LedgerEntry>();
  for (const groupEntries of groups.values()) {
    const clearing = groupEntries.find((entry) =>
      entry.accountCode === "1592" && (entry.cashChange || 0) > TOLERANCE,
    );
    const commission = groupEntries.find((entry) =>
      entry.accountCode === "8401" && (entry.cashChange || 0) > TOLERANCE,
    );
    if (!clearing || !commission) continue;

    const totalCash = roundMoney((clearing.cashChange || 0) + (commission.cashChange || 0));
    replacements.set(clearing.id, {
      ...clearing,
      amount: totalCash,
      description: "Prifoto Tagesverkauf bar / Gesamtbetrag",
      category: "1592 · Durchlaufende Posten / Prifoto",
      accountCode: "1592",
      counterAccountCode: "1000",
      cashChange: totalCash,
      netAmount: totalCash,
      note: appendNote(clearing.note, `${MODEL_MARKER}; historische Halbzeilen ohne Änderung des Kassenbestands korrigiert.`),
    });
    replacements.set(commission.id, {
      ...commission,
      description: "Prifoto Eigenanteil / interne Umbuchung",
      counterAccountCode: "1592",
      cashChange: 0,
      note: appendNote(commission.note, `${MODEL_MARKER}; Eigenanteil intern aus 1592 umgebucht.`),
    });
  }

  if (!replacements.size) return entries;
  return entries.map((entry) => replacements.get(entry.id) || entry);
}

function existingPrifotoByDate(entries: LedgerEntry[]): Map<string, ExistingPrifotoDay> {
  const result = new Map<string, ExistingPrifotoDay>();
  for (const entry of entries) {
    if (!isPrifotoEntry(entry)) continue;
    const current = result.get(entry.date) || emptyExistingDay();
    if ((entry.cashChange || 0) > TOLERANCE) {
      current.cashTotal = roundMoney(current.cashTotal + (entry.cashChange || 0));
    }
    if (entry.accountCode === "8401") {
      current.ownGross = roundMoney(current.ownGross + entry.amount);
      current.ownVat = roundMoney(current.ownVat + entry.taxAmount);
    }
    result.set(entry.date, current);
  }
  return result;
}

function isPrifotoEntry(entry: LedgerEntry): boolean {
  const text = `${entry.description} ${entry.category} ${entry.note || ""}`.toLowerCase();
  return entry.source === "prifotoImport" || text.includes("prifoto");
}

function emptyExistingDay(): ExistingPrifotoDay {
  return { cashTotal: 0, ownGross: 0, ownVat: 0 };
}

function splitDay(day: PrifotoDailySale) {
  const partnerShare = roundMoney(day.amount / 2);
  return { partnerShare, ownShare: roundMoney(day.amount - partnerShare) };
}

function appendNote(current: string | undefined, addition: string): string {
  if (!current) return addition;
  return current.includes(addition) ? current : `${current} · ${addition}`;
}

function close(left: number, right: number): boolean {
  return Math.abs(roundMoney(left - right)) <= TOLERANCE;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function money(value: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value);
}
