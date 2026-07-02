import { todayIso } from "@/lib/accounting";
import { SUPPLIER_BOOKKEEPING_ACCOUNTS } from "@/lib/document-control";
import type { ParsedInvoice, ParsedZReport } from "@/lib/document-parser";
import type { PaymentMethod } from "@/lib/types";
import { Field, Input, Select } from "../../ui";

export function ZReportFields({ parsed, update, bookSales, setBookSales }: {
  parsed: ParsedZReport;
  update: (key: string, value: string) => void;
  bookSales: boolean;
  setBookSales: (value: boolean) => void;
}) {
  return <div className="form-stack">
    <div className="form-grid two">
      <Field label="Datum"><Input type="date" value={parsed.date || todayIso()} onChange={(event) => update("date", event.target.value)} /></Field>
      <Field label="Z-Bericht Nr."><Input value={parsed.zNumber || ""} onChange={(event) => update("zNumber", event.target.value)} /></Field>
      <Money label="Brutto" value={parsed.gross} name="gross" update={update} />
      <Money label="Netto" value={parsed.net} name="net" update={update} />
      <Money label="MwSt." value={parsed.vat} name="vat" update={update} />
      <Money label="Bar" value={parsed.cash} name="cash" update={update} />
      <Money label="Karte" value={parsed.card} name="card" update={update} />
      <Money label="Differenz" value={parsed.difference} name="difference" update={update} />
    </div>
    <label className="check-card">
      <input type="checkbox" checked={bookSales} onChange={(event) => setBookSales(event.target.checked)} />
      <span><strong>Tagesumsatz buchen</strong><small>Nur aktivieren, wenn diese Verkäufe nicht bereits einzeln erfasst wurden.</small></span>
    </label>
  </div>;
}

export function InvoiceFields({ parsed, update, payment, setPayment, account, setAccount, paid, setPaid }: {
  parsed: ParsedInvoice;
  update: (key: string, value: string) => void;
  payment: PaymentMethod;
  setPayment: (value: PaymentMethod) => void;
  account: string;
  setAccount: (value: string) => void;
  paid: boolean;
  setPaid: (value: boolean) => void;
}) {
  return <div className="form-stack">
    <div className="alert alert-info">Beim Speichern wird die Rechnung automatisch als Ausgabe gebucht. Doppelte Rechnungen werden blockiert.</div>
    <div className="form-grid two">
      <Field label="Firma"><Input value={parsed.vendor || ""} onChange={(event) => update("vendor", event.target.value)} /></Field>
      <Field label="Rechnungsnummer"><Input value={parsed.invoiceNumber || ""} onChange={(event) => update("invoiceNumber", event.target.value)} /></Field>
      <Field label="Datum"><Input type="date" value={parsed.date || todayIso()} onChange={(event) => update("date", event.target.value)} /></Field>
      <Field label="Zahlungsart"><Select value={payment} onChange={(event) => setPayment(event.target.value as PaymentMethod)}><option value="bank">Bank</option><option value="paypal">PayPal</option><option value="cash">Bar</option><option value="card">Karte</option></Select></Field>
      <Field label="Buchungskonto"><Select value={account} onChange={(event) => setAccount(event.target.value)}>{SUPPLIER_BOOKKEEPING_ACCOUNTS.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.label}</option>)}</Select></Field>
      <Field label="Zahlungsstatus"><Select value={paid ? "paid" : "open"} onChange={(event) => setPaid(event.target.value === "paid")}><option value="paid">Bezahlt</option><option value="open">Offen</option></Select></Field>
      <Money label="Brutto" value={parsed.gross} name="gross" update={update} />
      <Money label="MwSt." value={parsed.vat} name="vat" update={update} />
    </div>
  </div>;
}

function Money({ label, value, name, update }: { label: string; value?: number; name: string; update: (key: string, value: string) => void }) {
  return <Field label={label}><Input type="number" step="0.01" value={value ?? ""} onChange={(event) => update(name, event.target.value)} /></Field>;
}
