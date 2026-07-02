"use client";

import { Fragment, useState, type ChangeEvent, type Dispatch, type SetStateAction } from "react";
import { BOOKING_CATEGORIES, getBookingCategory } from "@/lib/accounts";
import { formatCurrency, makeId, nextSequence } from "@/lib/accounting";
import {
  bookingKindLabel,
  cashEffect,
  createBookingDraft,
  effectiveAccount,
  includedTax,
  isTradeBooking,
  parseMoney,
  type BookingDraft,
} from "@/lib/manual-booking";
import { useKassenStore } from "@/lib/store";
import type { BusinessDocument, LedgerEntry, ManualBookingKind } from "@/lib/types";
import { Button, Field, Input, Modal, Select } from "../ui";

interface Props {
  open: boolean;
  draft: BookingDraft;
  setDraft: Dispatch<SetStateAction<BookingDraft>>;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function ManualBookingModal({ open, draft, setDraft, onClose, onSaved }: Props) {
  const { state, replaceState } = useKassenStore();
  const [error, setError] = useState("");
  const trade = isTradeBooking(draft.kind);
  const categories = BOOKING_CATEGORIES.filter((item) => item.side === (draft.kind === "income" ? "in" : "out"));
  const gross = parseMoney(draft.amount);
  const splitTotal = draft.lines.reduce((sum, line) => sum + parseMoney(line.amount), 0);

  function patch<K extends keyof BookingDraft>(key: K, value: BookingDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function switchKind(kind: ManualBookingKind) {
    setError("");
    setDraft(createBookingDraft(kind, draft.date));
  }

  function updateLine(index: number, patchValue: Partial<BookingDraft["lines"][number]>) {
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...patchValue } : line),
    }));
  }

  async function attachFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2_500_000) {
      setError("Bitte ein Bild bis maximal 2,5 MB wählen.");
      return;
    }
    const fileData = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    setDraft((current) => ({ ...current, fileName: file.name, fileData }));
  }

  function save() {
    try {
      const amount = parseMoney(draft.amount);
      if (amount <= 0) throw new Error("Bitte einen gültigen Betrag eingeben.");
      const lines = draft.split
        ? draft.lines.filter((line) => parseMoney(line.amount) > 0)
        : [{
            accountCode: effectiveAccount(draft),
            text: draft.text || defaultText(draft),
            amount: draft.amount,
            taxRate: trade ? draft.taxRate : 0,
          }];
      const linesTotal = lines.reduce((sum, line) => sum + parseMoney(line.amount), 0);
      if (Math.abs(linesTotal - amount) > 0.01) throw new Error("Teilbuchungen und Gesamtbetrag stimmen nicht überein.");

      const createdAt = new Date().toISOString();
      const groupId = makeId("booking");
      const totalTax = lines.reduce((sum, line) => sum + includedTax(parseMoney(line.amount), line.taxRate), 0);
      let document: BusinessDocument | undefined;
      if (draft.receipt || draft.fileData || draft.documentNumber) {
        const documentNumber = draft.receipt
          ? nextSequence(state.settings.receiptPrefix, state.documents.map((item) => item.documentNumber), new Date(`${draft.date}T12:00:00`))
          : draft.documentNumber || nextSequence("BEL", state.documents.map((item) => item.documentNumber), new Date(`${draft.date}T12:00:00`));
        document = {
          id: makeId("document"),
          documentNumber,
          type: draft.receipt ? "receipt" : "supplierInvoice",
          date: draft.date,
          amount,
          taxAmount: totalTax,
          taxMode: totalTax ? "standard19" : "taxFree",
          paymentMethod: draft.payment,
          status: "paid",
          originalFileName: draft.fileName,
          originalImageDataUrl: draft.fileData,
          metadata: { manual: true, bookingKind: draft.kind, accountCode: effectiveAccount(draft) },
          createdAt,
        };
      }

      const direction = draft.kind === "income" ? "income" : draft.kind === "expense" ? "expense" : "transfer";
      const entries: LedgerEntry[] = lines.map((line) => {
        const lineAmount = parseMoney(line.amount);
        const taxAmount = includedTax(lineAmount, line.taxRate);
        return {
          id: makeId("ledger"), date: draft.date, direction, amount: lineAmount,
          paymentMethod: trade ? draft.payment : "cash",
          description: line.text || defaultText(draft),
          category: `${line.accountCode} · ${line.text || defaultText(draft)}`,
          source: "manual", sourceId: groupId, documentId: document?.id,
          taxAmount, taxRate: line.taxRate, taxMode: line.taxRate ? "standard19" : "taxFree",
          reconciled: true, accountCode: line.accountCode,
          counterAccountCode: draft.kind === "transfer" ? "1200" : draft.kind === "private" ? effectiveAccount(draft) : undefined,
          documentNumber: document?.documentNumber || draft.documentNumber || undefined,
          groupId, cashChange: cashEffect(draft, lineAmount),
          netAmount: Math.round((lineAmount - taxAmount) * 100) / 100,
          attachmentFileName: draft.fileName, attachmentDataUrl: draft.fileData,
          note: draft.note || undefined, manualKind: draft.kind, createdAt,
        };
      });

      replaceState({
        ...state,
        documents: document ? [document, ...state.documents] : state.documents,
        ledger: [...entries, ...state.ledger],
      });
      setError("");
      onClose();
      onSaved("Buchung gespeichert. Der laufende Kassenbestand wurde aktualisiert.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Buchung konnte nicht gespeichert werden.");
    }
  }

  return (
    <Modal open={open} title="Buchung erfassen" onClose={onClose} wide footer={<Fragment><Button variant="secondary" onClick={onClose}>Abbrechen</Button><Button onClick={save}>Eintragen</Button></Fragment>}>
      <div className="booking-kind-tabs">
        {(["income", "expense", "transfer", "private"] as ManualBookingKind[]).map((kind) => (
          <button key={kind} className={draft.kind === kind ? "active" : ""} onClick={() => switchKind(kind)}>{bookingKindLabel(kind)}</button>
        ))}
      </div>
      {error ? <div className="alert alert-danger">{error}</div> : null}
      <div className="form-grid two">
        <Field label="Datum"><Input type="date" value={draft.date} onChange={(event) => patch("date", event.target.value)} /></Field>
        <Field label="Betrag (Brutto)"><Input inputMode="decimal" value={draft.amount} placeholder="0,00" onChange={(event) => patch("amount", event.target.value)} /></Field>
        {trade ? <Fragment>
          <Field label="Konto"><Select value={draft.accountCode} onChange={(event) => { const account = getBookingCategory(event.target.value); setDraft((current) => ({ ...current, accountCode: event.target.value, taxRate: account?.vat ?? current.taxRate })); }}>{categories.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.label}</option>)}</Select></Field>
          <Field label="Zahlungsart"><Select value={draft.payment} onChange={(event) => patch("payment", event.target.value as BookingDraft["payment"])}><option value="cash">Bar / Kasse</option><option value="card">Karte</option><option value="bank">Bank</option><option value="paypal">PayPal</option></Select></Field>
          <Field label="MwSt."><Select value={draft.taxRate} onChange={(event) => patch("taxRate", Number(event.target.value))}><option value={19}>19 %</option><option value={7}>7 %</option><option value={0}>0 %</option></Select></Field>
          <Field label="Belegnummer"><Input value={draft.documentNumber} onChange={(event) => patch("documentNumber", event.target.value)} /></Field>
        </Fragment> : null}
        {draft.kind === "transfer" ? <Field label="Umbuchung"><Select value={draft.transfer} onChange={(event) => patch("transfer", event.target.value as BookingDraft["transfer"])}><option value="cashToBank">Kasse → Bank</option><option value="bankToCash">Bank → Kasse</option></Select></Field> : null}
        {draft.kind === "private" ? <Field label="Privatvorgang"><Select value={draft.privateType} onChange={(event) => patch("privateType", event.target.value as BookingDraft["privateType"])}><option value="deposit">Privateinlage</option><option value="withdrawal">Privatentnahme</option></Select></Field> : null}
      </div>
      <div className="form-stack booking-details">
        <Field label="Text"><Input value={draft.text} placeholder={defaultText(draft)} onChange={(event) => patch("text", event.target.value)} /></Field>
        <Field label="Notiz"><textarea className="input textarea" value={draft.note} onChange={(event) => patch("note", event.target.value)} /></Field>
        <Field label="Dokument / Foto" hint={draft.fileName || "Bild bis 2,5 MB"}><Input type="file" accept="image/*" onChange={attachFile} /></Field>
      </div>
      {trade ? <div className="booking-options">
        <label className="check-card"><input type="checkbox" checked={draft.split} onChange={(event) => patch("split", event.target.checked)} /><span><strong>Buchung aufteilen</strong><small>Mehrere Konten oder Steuersätze.</small></span></label>
        {draft.kind === "income" ? <label className="check-card"><input type="checkbox" checked={draft.receipt} onChange={(event) => patch("receipt", event.target.checked)} /><span><strong>Quittung erstellen</strong><small>Fortlaufende Quittungsnummer erzeugen.</small></span></label> : null}
      </div> : null}
      {trade && draft.split ? <div className="split-box">
        {draft.lines.map((line, index) => <div className="split-row" key={index}><Select value={line.accountCode} onChange={(event) => updateLine(index, { accountCode: event.target.value })}>{categories.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.label}</option>)}</Select><Input value={line.text} placeholder="Text" onChange={(event) => updateLine(index, { text: event.target.value })} /><Input value={line.amount} placeholder="0,00" onChange={(event) => updateLine(index, { amount: event.target.value })} /><Select value={line.taxRate} onChange={(event) => updateLine(index, { taxRate: Number(event.target.value) })}><option value={19}>19 %</option><option value={7}>7 %</option><option value={0}>0 %</option></Select></div>)}
        <Button variant="secondary" onClick={() => setDraft((current) => ({ ...current, lines: [...current.lines, { accountCode: draft.kind === "expense" ? "4980" : "8400", text: "", amount: "", taxRate: 19 }] }))}>Zeile hinzufügen</Button>
        <div className={`split-total ${Math.abs(splitTotal - gross) <= 0.01 ? "ok" : "warning"}`}><span>Teilbuchungen</span><strong>{formatCurrency(splitTotal)}</strong></div>
      </div> : null}
      <div className="calculation-box"><h3>Vorschau</h3><div><span>Brutto</span><strong>{formatCurrency(gross)}</strong></div>{trade ? <Fragment><div><span>Steuer</span><strong>{formatCurrency(includedTax(gross, draft.taxRate))}</strong></div><div><span>Netto</span><strong>{formatCurrency(gross - includedTax(gross, draft.taxRate))}</strong></div></Fragment> : <div><span>Auswirkung Kasse</span><strong>{cashEffect(draft, gross) >= 0 ? "+" : "−"}{formatCurrency(Math.abs(cashEffect(draft, gross)))}</strong></div>}</div>
    </Modal>
  );
}

function defaultText(draft: BookingDraft): string {
  if (draft.kind === "private") return draft.privateType === "deposit" ? "Privateinlage" : "Privatentnahme";
  if (draft.kind === "transfer") return draft.transfer === "bankToCash" ? "Bank an Kasse" : "Kasse an Bank";
  return getBookingCategory(draft.accountCode)?.label || bookingKindLabel(draft.kind);
}
