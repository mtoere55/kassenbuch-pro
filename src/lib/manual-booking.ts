import { getTaxAmountFromGross, todayIso } from "./accounting";
import type { LedgerEntry, PaymentMethod } from "./types";

export type ManualBookingKind = "income" | "expense" | "transfer" | "private";

export interface SplitLine {
  accountCode: string;
  text: string;
  amount: string;
  taxRate: number;
}

export interface BookingDraft {
  kind: ManualBookingKind;
  date: string;
  amount: string;
  payment: PaymentMethod;
  text: string;
  accountCode: string;
  taxRate: number;
  documentNumber: string;
  note: string;
  transfer: "cashToBank" | "bankToCash";
  privateType: "deposit" | "withdrawal";
  receipt: boolean;
  split: boolean;
  lines: SplitLine[];
  fileName?: string;
  fileData?: string;
}

export function createBookingDraft(kind: ManualBookingKind = "income", date = todayIso()): BookingDraft {
  const expense = kind === "expense";
  return {
    kind,
    date,
    amount: "",
    payment: "cash",
    text: "",
    accountCode: expense ? "4930" : kind === "income" ? "8400" : kind === "private" ? "1890" : "1360",
    taxRate: kind === "income" || expense ? 19 : 0,
    documentNumber: "",
    note: "",
    transfer: "cashToBank",
    privateType: "deposit",
    receipt: false,
    split: false,
    lines: [
      { accountCode: expense ? "4930" : "8400", text: "", amount: "", taxRate: 19 },
      { accountCode: expense ? "4980" : "8400", text: "", amount: "", taxRate: 19 },
    ],
  };
}

export function parseMoney(value: string): number {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isTradeBooking(kind: ManualBookingKind): boolean {
  return kind === "income" || kind === "expense";
}

export function effectiveAccount(draft: BookingDraft): string {
  if (draft.kind !== "private") return draft.accountCode;
  return draft.privateType === "deposit" ? "1890" : "1800";
}

export function cashEffect(draft: BookingDraft, amount: number): number {
  if (draft.kind === "income") return draft.payment === "cash" ? amount : 0;
  if (draft.kind === "expense") return draft.payment === "cash" ? -amount : 0;
  if (draft.kind === "private") return draft.privateType === "deposit" ? amount : -amount;
  return draft.transfer === "bankToCash" ? amount : -amount;
}

export function entryCashEffect(entry: LedgerEntry): number {
  if (typeof entry.cashChange === "number") return entry.cashChange;
  if (entry.paymentMethod !== "cash") return 0;
  if (entry.direction === "income") return entry.amount;
  if (entry.direction === "expense") return -entry.amount;
  return 0;
}

export function includedTax(amount: number, rate: number): number {
  return rate ? getTaxAmountFromGross(amount, rate) : 0;
}

export function bookingKindLabel(kind: ManualBookingKind): string {
  return ({ income: "Einnahme", expense: "Ausgabe", transfer: "Umbuchung", private: "Privat" } as const)[kind];
}
