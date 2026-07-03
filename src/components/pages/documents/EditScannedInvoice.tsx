"use client";

import { SUPPLIER_BOOKKEEPING_ACCOUNTS } from "@/lib/document-control";
import type { BusinessDocument, PaymentMethod } from "@/lib/types";
import { Field, Input, Select } from "../../ui";

export interface ScannedInvoiceDraft {
  vendor: string;
  invoiceNumber: string;
  date: string;
  gross: string;
  vat: string;
  paymentMethod: PaymentMethod;
  status: "paid" | "open";
  accountCode: string;
}

export function createScannedInvoiceDraft(document: BusinessDocument): ScannedInvoiceDraft {
  return {
    vendor: String(document.metadata?.vendor || ""),
    invoiceNumber: String(document.metadata?.invoiceNumber || ""),
    date: document.date,
    gross: document.amount.toFixed(2).replace(".", ","),
    vat: document.taxAmount.toFixed(2).replace(".", ","),
    paymentMethod: document.paymentMethod || "bank",
    status: document.status === "open" ? "open" : "paid",
    accountCode: String(document.metadata?.accountCode || "4980"),
  };
}

export function EditScannedInvoice({
  draft,
  onChange,
}: {
  draft: ScannedInvoiceDraft;
  onChange: (draft: ScannedInvoiceDraft) => void;
}) {
  function set<K extends keyof ScannedInvoiceDraft>(key: K, value: ScannedInvoiceDraft[K]) {
    onChange({ ...draft, [key]: value });
  }

  return (
    <div className="form-stack">
      <div className="alert alert-info">
        Änderungen werden gleichzeitig im Dokument und in der verbundenen Buchhaltung übernommen.
      </div>
      <div className="form-grid two">
        <Field label="Lieferant">
          <Input value={draft.vendor} onChange={(event) => set("vendor", event.target.value)} />
        </Field>
        <Field label="Rechnungsnummer">
          <Input value={draft.invoiceNumber} onChange={(event) => set("invoiceNumber", event.target.value)} />
        </Field>
        <Field label="Datum">
          <Input type="date" value={draft.date} onChange={(event) => set("date", event.target.value)} />
        </Field>
        <Field label="Zahlungsart">
          <Select
            value={draft.paymentMethod}
            onChange={(event) => set("paymentMethod", event.target.value as PaymentMethod)}
          >
            <option value="cash">Bar</option>
            <option value="bank">Bank</option>
            <option value="paypal">PayPal</option>
            <option value="card">Karte</option>
          </Select>
        </Field>
        <Field label="Buchungskonto">
          <Select value={draft.accountCode} onChange={(event) => set("accountCode", event.target.value)}>
            {SUPPLIER_BOOKKEEPING_ACCOUNTS.map((account) => (
              <option key={account.code} value={account.code}>
                {account.code} · {account.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Zahlungsstatus">
          <Select
            value={draft.status}
            onChange={(event) => set("status", event.target.value as "paid" | "open")}
          >
            <option value="paid">Bezahlt</option>
            <option value="open">Offen</option>
          </Select>
        </Field>
        <Field label="Brutto">
          <Input
            inputMode="decimal"
            value={draft.gross}
            onChange={(event) => set("gross", event.target.value)}
          />
        </Field>
        <Field label="MwSt.">
          <Input
            inputMode="decimal"
            value={draft.vat}
            onChange={(event) => set("vat", event.target.value)}
          />
        </Field>
      </div>
    </div>
  );
}
