import { getTaxAmountFromGross, makeId, nextSequence } from "./accounting";
import { createPeriodBookingNumberAllocator } from "./business-booking-rules";
import type { AppState, BusinessDocument, LedgerEntry, PaymentMethod } from "./types";

export type ServiceBookingKind = "unitelTopup" | "unitelCommission" | "prifotoSale";

export interface ServiceBookingInput {
  kind: ServiceBookingKind;
  date: string;
  amount: number;
  paymentMethod: PaymentMethod;
  commissionAmount?: number;
  ownShareAmount?: number;
  createReceipt: boolean;
  note?: string;
}

export interface ServiceBookingResult {
  state: AppState;
  entries: LedgerEntry[];
  document?: BusinessDocument;
}

export function createServiceBooking(current: AppState, input: ServiceBookingInput): ServiceBookingResult {
  validateInput(input);
  const createdAt = new Date().toISOString();
  const groupId = makeId("service");
  const allocateCashNumber = createPeriodBookingNumberAllocator("KASSE", current.ledger);
  const bookingNumber = allocateCashNumber(input.date);
  const document = input.createReceipt
    ? createReceipt(current, input, bookingNumber, createdAt)
    : undefined;
  const reference = document?.documentNumber || bookingNumber;
  const entries = buildEntries(input, reference, document?.id, groupId, createdAt);

  return {
    entries,
    document,
    state: {
      ...current,
      documents: document ? [document, ...current.documents] : current.documents,
      ledger: [...entries, ...current.ledger],
    },
  };
}

function buildEntries(
  input: ServiceBookingInput,
  documentNumber: string,
  documentId: string | undefined,
  groupId: string,
  createdAt: string,
): LedgerEntry[] {
  if (input.kind === "unitelTopup") {
    const commission = roundMoney(input.commissionAmount || 0);
    const clearing = roundMoney(input.amount - commission);
    const entries: LedgerEntry[] = [];
    if (clearing > 0) {
      entries.push(baseEntry({
        input,
        documentNumber,
        documentId,
        groupId,
        createdAt,
        amount: clearing,
        direction: "transfer",
        description: "UniTel Guthabenverkauf / durchlaufender Posten",
        category: "1590 · Durchlaufende Posten / UniTel",
        accountCode: "1590",
        taxRate: 0,
        manualKind: "transfer",
        note: `Nominalwert ${money(input.amount)}; sofort berücksichtigte Provision ${money(commission)}.`,
      }));
    }
    if (commission > 0) {
      entries.push(baseEntry({
        input,
        documentNumber,
        documentId,
        groupId,
        createdAt,
        amount: commission,
        direction: "income",
        description: "UniTel Guthaben-Provision",
        category: "8403 · Provisionserlöse 19 Prozent",
        accountCode: "8403",
        taxRate: 19,
        manualKind: "income",
        note: "Provision aus dem Guthabenverkauf; mit der Unitel-Abrechnung abgleichen.",
      }));
    }
    return entries;
  }

  if (input.kind === "unitelCommission") {
    return [baseEntry({
      input,
      documentNumber,
      documentId,
      groupId,
      createdAt,
      amount: input.amount,
      direction: "income",
      description: "UniTel Vertrags- / Partnerprovision",
      category: "8403 · Provisionserlöse 19 Prozent",
      accountCode: "8403",
      taxRate: 19,
      manualKind: "income",
      note: "Unitel-Vertragsprovision; Gutschrift oder Provisionsabrechnung zuordnen.",
    })];
  }

  const ownShare = roundMoney(input.ownShareAmount ?? input.amount / 2);
  const partnerShare = roundMoney(input.amount - ownShare);
  const entries: LedgerEntry[] = [];
  if (partnerShare > 0) {
    entries.push(baseEntry({
      input,
      documentNumber,
      documentId,
      groupId,
      createdAt,
      amount: partnerShare,
      direction: "transfer",
      description: "Prifoto Fremdanteil / Verrechnung",
      category: "1592 · Durchlaufende Posten / Prifoto",
      accountCode: "1592",
      taxRate: 0,
      manualKind: "transfer",
      note: `Kundenzahlung ${money(input.amount)}; Prifoto-Anteil ${money(partnerShare)}.`,
    }));
  }
  if (ownShare > 0) {
    entries.push(baseEntry({
      input,
      documentNumber,
      documentId,
      groupId,
      createdAt,
      amount: ownShare,
      direction: "income",
      description: "Prifoto Eigenanteil / Provision",
      category: "8401 · Erlöse 19 Prozent / Prifoto Eigenanteil",
      accountCode: "8401",
      taxRate: 19,
      manualKind: "income",
      note: `Kundenzahlung ${money(input.amount)}; eigener Anteil ${money(ownShare)}; Prifoto-Anteil ${money(partnerShare)}.`,
    }));
  }
  return entries;
}

function baseEntry(values: {
  input: ServiceBookingInput;
  documentNumber: string;
  documentId?: string;
  groupId: string;
  createdAt: string;
  amount: number;
  direction: LedgerEntry["direction"];
  description: string;
  category: string;
  accountCode: string;
  taxRate: 0 | 19;
  manualKind: NonNullable<LedgerEntry["manualKind"]>;
  note: string;
}): LedgerEntry {
  const taxAmount = values.taxRate ? getTaxAmountFromGross(values.amount, values.taxRate) : 0;
  return {
    id: makeId("ledger"),
    date: values.input.date,
    direction: values.direction,
    amount: values.amount,
    paymentMethod: values.input.paymentMethod,
    description: values.description,
    category: values.category,
    source: values.input.kind === "prifotoSale" ? "prifotoImport" : "unitelImport",
    sourceId: values.groupId,
    documentId: values.documentId,
    taxAmount,
    taxRate: values.taxRate,
    taxMode: values.taxRate ? "standard19" : "taxFree",
    reconciled: true,
    accountCode: values.accountCode,
    counterAccountCode: paymentAccount(values.input.paymentMethod),
    documentNumber: values.documentNumber,
    groupId: values.groupId,
    cashChange: values.input.paymentMethod === "cash" ? values.amount : 0,
    netAmount: roundMoney(values.amount - taxAmount),
    note: [values.note, values.input.note?.trim()].filter(Boolean).join(" · ") || undefined,
    manualKind: values.manualKind,
    createdAt: values.createdAt,
  };
}

function createReceipt(
  current: AppState,
  input: ServiceBookingInput,
  bookingNumber: string,
  createdAt: string,
): BusinessDocument {
  const documentNumber = nextSequence(
    current.settings.receiptPrefix,
    current.documents.map((document) => document.documentNumber),
    new Date(`${input.date}T12:00:00`),
  );
  const taxBase = input.kind === "unitelTopup"
    ? roundMoney(input.commissionAmount || 0)
    : input.kind === "prifotoSale"
      ? roundMoney(input.ownShareAmount ?? input.amount / 2)
      : input.amount;
  return {
    id: makeId("document"),
    documentNumber,
    type: "receipt",
    date: input.date,
    amount: input.amount,
    taxAmount: taxBase > 0 ? getTaxAmountFromGross(taxBase, 19) : 0,
    taxMode: taxBase > 0 ? "standard19" : "taxFree",
    paymentMethod: input.paymentMethod,
    status: "paid",
    metadata: {
      serviceBookingKind: input.kind,
      bookingNumber,
      nominalAmount: input.amount,
      commissionAmount: input.kind === "unitelTopup" ? roundMoney(input.commissionAmount || 0) : null,
      ownShareAmount: input.kind === "prifotoSale" ? roundMoney(input.ownShareAmount ?? input.amount / 2) : null,
      partnerShareAmount: input.kind === "prifotoSale" ? roundMoney(input.amount - (input.ownShareAmount ?? input.amount / 2)) : null,
      accountingNote: serviceLabel(input.kind),
    },
    createdAt,
  };
}

function validateInput(input: ServiceBookingInput) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error("Bitte ein gültiges Datum wählen.");
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("Bitte einen gültigen Gesamtbetrag eingeben.");
  if (input.kind === "unitelTopup") {
    const commission = input.commissionAmount || 0;
    if (!Number.isFinite(commission) || commission < 0 || commission > input.amount) {
      throw new Error("Die Unitel-Provision muss zwischen 0 und dem Guthabenbetrag liegen.");
    }
  }
  if (input.kind === "prifotoSale") {
    const ownShare = input.ownShareAmount ?? input.amount / 2;
    if (!Number.isFinite(ownShare) || ownShare < 0 || ownShare > input.amount) {
      throw new Error("Der eigene Prifoto-Anteil muss zwischen 0 und dem Gesamtbetrag liegen.");
    }
  }
}

function paymentAccount(method: PaymentMethod): string {
  return ({ cash: "1000", card: "1360", bank: "1200", paypal: "1370" } as const)[method];
}

function serviceLabel(kind: ServiceBookingKind): string {
  return kind === "unitelTopup"
    ? "UniTel Guthabenverkauf"
    : kind === "unitelCommission"
      ? "UniTel Vertragsprovision"
      : "Prifoto 50/50 Kundenzahlung";
}

function money(value: number): string {
  return `${roundMoney(value).toFixed(2)} EUR`;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
