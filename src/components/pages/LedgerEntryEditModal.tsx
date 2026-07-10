"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { BOOKING_CATEGORIES, getBookingCategory } from "@/lib/accounts";
import { calculateDifferentialTax, formatCurrency, formatDate } from "@/lib/accounting";
import { entryCashEffect, includedTax, parseMoney } from "@/lib/manual-booking";
import { useKassenStore } from "@/lib/store";
import type { LedgerDirection, LedgerEntry, PaymentMethod, TaxMode } from "@/lib/types";
import { Button, Field, Input, Modal, Select } from "../ui";

interface Props {
  entry?: LedgerEntry;
  onClose: () => void;
  onSaved: (message: string) => void;
}

interface EntryDraft {
  date: string;
  direction: LedgerDirection;
  paymentMethod: PaymentMethod;
  bookingAccountCode: string;
  description: string;
  amount: string;
  taxRate: number;
  documentNumber: string;
  note: string;
}

export function LedgerEntryEditModal({ entry, onClose, onSaved }: Props) {
  const { state, replaceState } = useKassenStore();
  const relatedDocument = entry ? state.documents.find((document) => document.id === entry.documentId) : undefined;
  const relatedDevice = relatedDocument?.deviceId ? state.devices.find((device) => device.id === relatedDocument.deviceId) : undefined;
  const [draft, setDraft] = useState<EntryDraft>(() => createDraft(entry, relatedDocument?.documentNumber));
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(createDraft(entry, relatedDocument?.documentNumber));
    setError("");
  }, [entry, relatedDocument?.documentNumber]);

  const amount = parseMoney(draft.amount);
  const isDifferentialSale = Boolean(entry?.taxMode === "differential" && draft.direction === "income" && relatedDevice);
  const taxAmount = calculateEntryTax(amount, draft.taxRate, isDifferentialSale, relatedDevice?.purchasePrice);
  const cashChange = entry ? calculateCashChange(entry, draft.direction, draft.paymentMethod, amount) : 0;
  const bookingAccount = getBookingCategory(draft.bookingAccountCode);
  const isTransfer = draft.direction === "transfer";
  const accountOptions = useMemo(() => {
    if (draft.direction === "income") return BOOKING_CATEGORIES.filter((item) => item.side === "in" || item.code === draft.bookingAccountCode);
    if (draft.direction === "expense") return BOOKING_CATEGORIES.filter((item) => item.side === "out" || item.code === draft.bookingAccountCode);
    return BOOKING_CATEGORIES;
  }, [draft.bookingAccountCode, draft.direction]);

  if (!entry) return null;

  function patch<K extends keyof EntryDraft>(key: K, value: EntryDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function save() {
    if (!entry) return;
    try {
      if (amount <= 0) throw new Error("Bitte einen gültigen Betrag eingeben.");
      const updatedTaxAmount = calculateEntryTax(amount, draft.taxRate, isDifferentialSale, relatedDevice?.purchasePrice);
      const nextTaxMode: TaxMode = isDifferentialSale
        ? "differential"
        : draft.taxRate
          ? entry.taxMode === "differential" ? "differential" : "standard19"
          : "taxFree";
      const bookingLabel = getBookingCategory(draft.bookingAccountCode)?.label || accountLabelFromEntry(entry);
      const documentNumber = draft.documentNumber.trim() || relatedDocument?.documentNumber || undefined;
      const nextEntry: LedgerEntry = {
        ...entry,
        date: draft.date,
        direction: draft.direction,
        amount,
        paymentMethod: draft.paymentMethod,
        description: draft.description.trim() || bookingLabel,
        category: `${draft.bookingAccountCode} · ${bookingLabel}`,
        taxAmount: updatedTaxAmount,
        taxRate: draft.taxRate,
        taxMode: nextTaxMode,
        accountCode: isTransfer ? entry.accountCode || cashAccountForPayment(draft.paymentMethod) : draft.bookingAccountCode,
        counterAccountCode: isTransfer ? draft.bookingAccountCode : entry.counterAccountCode,
        documentNumber,
        cashChange: calculateCashChange(entry, draft.direction, draft.paymentMethod, amount),
        netAmount: roundMoney(amount - updatedTaxAmount),
        note: draft.note.trim() || undefined,
      };

      replaceState({
        ...state,
        ledger: state.ledger.map((item) => item.id === entry.id ? nextEntry : item),
        documents: state.documents.map((document) => {
          if (document.id !== entry.documentId) return document;
          return {
            ...document,
            date: draft.date,
            amount,
            taxAmount: updatedTaxAmount,
            taxMode: nextTaxMode,
            paymentMethod: draft.paymentMethod,
            documentNumber: documentNumber || document.documentNumber,
          };
        }),
      });
      onSaved("Buchung wurde aktualisiert.");
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Buchung konnte nicht gespeichert werden.");
    }
  }

  function deleteEntry() {
    if (!entry) return;
    const ok = window.confirm("Diese Buchung wirklich löschen? Der gespeicherte Beleg/PDF bleibt im Archiv erhalten.");
    if (!ok) return;
    replaceState({
      ...state,
      ledger: state.ledger.filter((item) => item.id !== entry.id),
    });
    onSaved("Buchung wurde gelöscht.");
    onClose();
  }

  function printCard() {
    window.print();
  }

  const netAmount = roundMoney(amount - taxAmount);

  return (
    <Modal
      open={Boolean(entry)}
      title="Buchung bearbeiten"
      onClose={onClose}
      wide
      footer={
        <Fragment>
          <Button variant="danger" onClick={deleteEntry}>Buchung löschen</Button>
          <Button variant="secondary" icon="print" onClick={printCard}>Drucken</Button>
          <Button variant="secondary" onClick={onClose}>Schließen</Button>
          <Button onClick={save}>Änderung speichern</Button>
        </Fragment>
      }
    >
      <div className="screen-only">
        <div className="entry-card-head">
          <div><small>Buchen / Bearbeiten</small><strong>{formatDate(entry.date)}</strong></div>
          <div><small>Konto</small><strong>{cashAccountTitle(entry)}</strong></div>
          <div><small>Kassenwirkung</small><strong className={cashChange < 0 ? "money-negative" : "money-positive"}>{cashChange >= 0 ? "+" : "−"}{formatCurrency(Math.abs(cashChange))}</strong></div>
        </div>
        {error ? <div className="alert alert-danger">{error}</div> : null}
        {entry.source !== "manual" ? <div className="alert alert-info">Diese Buchung kommt aus einem Import ({entry.source}). Änderungen sind möglich, aber der ursprüngliche Importbeleg bleibt zur Kontrolle erhalten.</div> : null}
        {isDifferentialSale ? <div className="alert alert-info">§25a: Die Umsatzsteuer wird nur aus der Differenz berechnet. Einkauf {formatCurrency(relatedDevice?.purchasePrice || 0)}, Verkauf {formatCurrency(amount)}, Marge {formatCurrency(Math.max(0, amount - (relatedDevice?.purchasePrice || 0)))}.</div> : null}
        <div className="form-grid two">
          <Field label="Datum"><Input type="date" value={draft.date} onChange={(event) => patch("date", event.target.value)} /></Field>
          <Field label="Art"><Select value={draft.direction} onChange={(event) => patch("direction", event.target.value as LedgerDirection)}><option value="income">Einnahme</option><option value="expense">Ausgabe</option><option value="transfer">Umbuchung / Fremdgeld</option></Select></Field>
          <Field label="Buchungskonto" hint={isTransfer ? "Gegenkonto zur Kasse, z.B. 1590 UniTel Guthaben" : undefined}><Select value={draft.bookingAccountCode} onChange={(event) => patch("bookingAccountCode", event.target.value)}>{accountOptions.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.label}</option>)}</Select></Field>
          <Field label="Zahlungsart"><Select value={draft.paymentMethod} onChange={(event) => patch("paymentMethod", event.target.value as PaymentMethod)}><option value="cash">Bar / Kasse</option><option value="card">Karte</option><option value="bank">Bank</option><option value="paypal">PayPal</option></Select></Field>
          <Field label="Betrag (Brutto)"><Input inputMode="decimal" value={draft.amount} onChange={(event) => patch("amount", event.target.value)} /></Field>
          <Field label="MwSt." hint={isDifferentialSale ? "§25a: Steuer nur aus der Marge" : undefined}><Select value={draft.taxRate} onChange={(event) => patch("taxRate", Number(event.target.value))}><option value={19}>19 %</option><option value={7}>7 %</option><option value={0}>0 %</option></Select></Field>
          <Field label="Beleg / Buchung Nr."><Input value={draft.documentNumber} onChange={(event) => patch("documentNumber", event.target.value)} /></Field>
          <Field label="Text"><Input value={draft.description} onChange={(event) => patch("description", event.target.value)} /></Field>
        </div>
        <div className="form-stack booking-details"><Field label="Notiz"><textarea className="input textarea" value={draft.note} onChange={(event) => patch("note", event.target.value)} /></Field></div>
        <div className="calculation-box"><h3>Vorschau</h3><div><span>Brutto</span><strong>{formatCurrency(amount)}</strong></div>{isDifferentialSale ? <div><span>§25a Marge</span><strong>{formatCurrency(Math.max(0, amount - (relatedDevice?.purchasePrice || 0)))}</strong></div> : null}<div><span>MwSt.</span><strong>{formatCurrency(taxAmount)}</strong></div><div><span>Netto</span><strong>{formatCurrency(netAmount)}</strong></div><div><span>Buchungskonto</span><strong>{draft.bookingAccountCode} · {bookingAccount?.label || accountLabelFromEntry(entry)}</strong></div></div>
      </div>

      <div className="print-only entry-print-card">
        <div className="document-head"><div><div className="document-brand">Kassenbuch Pro</div><div>{state.settings.businessName}</div><div>{state.settings.ownerName}</div><div>{state.settings.street}</div><div>{state.settings.postalCode} {state.settings.city}</div></div><div className="document-meta"><h1>Buchung</h1><div><span>Datum</span><strong>{formatDate(draft.date)}</strong></div><div><span>Beleg</span><strong>{draft.documentNumber || relatedDocument?.documentNumber || "-"}</strong></div></div></div>
        <table className="document-table"><tbody><tr><th>Kassenkonto</th><td>{cashAccountTitle(entry)}</td></tr><tr><th>Buchungskonto</th><td>{draft.bookingAccountCode} · {bookingAccount?.label || accountLabelFromEntry(entry)}</td></tr><tr><th>Text</th><td>{draft.description || "-"}</td></tr><tr><th>Betrag</th><td>{formatCurrency(amount)}</td></tr>{isDifferentialSale ? <tr><th>§25a Marge</th><td>{formatCurrency(Math.max(0, amount - (relatedDevice?.purchasePrice || 0)))}</td></tr> : null}<tr><th>MwSt.</th><td>{draft.taxRate ? `${draft.taxRate} % / ${formatCurrency(taxAmount)}` : "0 %"}</td></tr><tr><th>Netto</th><td>{formatCurrency(netAmount)}</td></tr><tr><th>Kassenwirkung</th><td>{cashChange >= 0 ? "+" : "−"}{formatCurrency(Math.abs(cashChange))}</td></tr></tbody></table>
        {draft.note ? <p className="tax-note">Notiz: {draft.note}</p> : null}
      </div>
    </Modal>
  );
}

function createDraft(entry?: LedgerEntry, documentNumber?: string): EntryDraft {
  return {
    date: entry?.date || "",
    direction: entry?.direction || "income",
    paymentMethod: entry?.paymentMethod || "cash",
    bookingAccountCode: entry ? bookingAccountCode(entry) : "8400",
    description: entry?.description || "",
    amount: entry ? moneyInput(entry.amount) : "",
    taxRate: entry?.taxRate ?? 0,
    documentNumber: entry?.documentNumber || documentNumber || "",
    note: entry?.note || "",
  };
}

function bookingAccountCode(entry: LedgerEntry): string {
  if (entry.direction === "transfer" && entry.counterAccountCode) return entry.counterAccountCode;
  if (entry.sourceId?.startsWith("unitel-sales:") && entry.counterAccountCode) return entry.counterAccountCode;
  if (entry.sourceId?.startsWith("prifoto-sales:") && entry.counterAccountCode) return entry.counterAccountCode;
  if (entry.accountCode) return entry.accountCode;
  const match = entry.category.match(/^(\d{4})/);
  return match?.[1] || (entry.taxMode === "differential" && entry.direction === "income" ? "8336" : entry.direction === "expense" ? "3290" : "0000");
}

function accountLabelFromEntry(entry: LedgerEntry): string {
  const code = bookingAccountCode(entry);
  return getBookingCategory(code)?.label || entry.category.split("·").slice(1).join("·").trim() || entry.category;
}

function cashAccountTitle(entry: LedgerEntry): string {
  if (entry.paymentMethod === "card") return "01360 Geldtransit und Karte";
  if (entry.paymentMethod === "bank") return "01200 Bank";
  if (entry.paymentMethod === "paypal") return "01370 PayPal";
  return "01000 Kasse";
}

function cashAccountForPayment(payment: PaymentMethod): string {
  if (payment === "card") return "1360";
  if (payment === "bank") return "1200";
  if (payment === "paypal") return "1370";
  return "1000";
}

function calculateCashChange(entry: LedgerEntry, direction: LedgerDirection, payment: PaymentMethod, amount: number): number {
  if (direction === "income") return payment === "cash" ? amount : 0;
  if (direction === "expense") return payment === "cash" ? -amount : 0;
  if (payment !== "cash") return 0;
  const current = entryCashEffect(entry);
  return current < 0 ? -amount : amount;
}

function calculateEntryTax(amount: number, rate: number, isDifferentialSale: boolean, purchasePrice?: number): number {
  if (isDifferentialSale) return calculateDifferentialTax(amount, purchasePrice || 0, rate || 19);
  return includedTax(amount, rate);
}

function moneyInput(value: number): string {
  return new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
