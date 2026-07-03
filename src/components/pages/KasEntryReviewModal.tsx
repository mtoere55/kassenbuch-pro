"use client";

import { useMemo, useState } from "react";
import { formatCurrency } from "@/lib/accounting";
import {
  buildReviewAccountOptions,
  correctKasEntry,
  isUnresolvedKasEntry,
} from "@/lib/kas-review";
import { parseDecimal } from "@/lib/invoice-validation";
import { useKassenStore } from "@/lib/store";
import type { LedgerDirection, LedgerEntry, PaymentMethod } from "@/lib/types";
import { Badge, Button, Field, Input, Modal, Select } from "../ui";

export function KasEntryReviewModal({
  entry,
  onClose,
  onSaved,
}: {
  entry?: LedgerEntry;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  return entry ? (
    <KasEntryReviewForm key={entry.id} entry={entry} onClose={onClose} onSaved={onSaved} />
  ) : null;
}

function KasEntryReviewForm({
  entry,
  onClose,
  onSaved,
}: {
  entry: LedgerEntry;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { state, replaceState } = useKassenStore();
  const accounts = useMemo(() => buildReviewAccountOptions(state.ledger), [state.ledger]);
  const [date, setDate] = useState(entry.date);
  const [description, setDescription] = useState(entry.description);
  const [amount, setAmount] = useState(entry.amount.toFixed(2).replace(".", ","));
  const [direction, setDirection] = useState<LedgerDirection>(entry.direction);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(entry.paymentMethod);
  const [accountCode, setAccountCode] = useState(entry.accountCode || "0000");
  const [taxRate, setTaxRate] = useState<0 | 7 | 19>(
    entry.taxRate === 7 ? 7 : entry.taxRate === 19 ? 19 : 0,
  );
  const [error, setError] = useState("");

  const selectedAccount = accounts.find((account) => account.code === accountCode);
  const differential = ["3290", "8336", "8390"].includes(accountCode);
  const gross = parseDecimal(amount);
  const estimatedTax = differential || taxRate === 0
    ? 0
    : Math.round(((gross * taxRate) / (100 + taxRate)) * 100) / 100;

  function selectAccount(code: string) {
    setAccountCode(code);
    const account = accounts.find((item) => item.code === code);
    if (!account) return;
    setTaxRate(account.vat);
    if (account.side === "in") setDirection("income");
    if (account.side === "out") setDirection("expense");
  }

  function save() {
    setError("");
    try {
      const updated = correctKasEntry(
        entry,
        {
          date,
          description,
          amount: gross,
          direction,
          paymentMethod,
          accountCode,
          taxRate: differential ? 0 : taxRate,
        },
        accounts,
      );
      replaceState({
        ...state,
        ledger: state.ledger.map((item) => (item.id === entry.id ? updated : item)),
      });
      onSaved(
        `${entry.documentNumber || entry.description} wurde geprüft und auf ${updated.accountCode} gebucht.`,
      );
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Die Buchung konnte nicht korrigiert werden.");
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="KAS-Buchung prüfen"
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Abbrechen</Button>
          <Button onClick={save}>Prüfung speichern</Button>
        </>
      }
    >
      <div className="form-stack">
        <div className={isUnresolvedKasEntry(entry) ? "alert alert-warning" : "alert alert-info"}>
          {isUnresolvedKasEntry(entry)
            ? "Diese Buchung hat noch kein gültiges Konto. Bitte Beleg und Geschäftsvorgang prüfen."
            : "Hier kannst du eine importierte KAS-Buchung berichtigen. Der laufende Kassenbestand wird automatisch neu berechnet."}
        </div>
        {error ? <div className="alert alert-danger">{error}</div> : null}
        <div className="form-grid two">
          <Field label="Datum">
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </Field>
          <Field label="Betrag">
            <Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </Field>
          <Field label="Text">
            <Input value={description} onChange={(event) => setDescription(event.target.value)} />
          </Field>
          <Field label="Vorgang">
            <Select value={direction} onChange={(event) => setDirection(event.target.value as LedgerDirection)}>
              <option value="income">Einnahme</option>
              <option value="expense">Ausgabe</option>
              <option value="transfer">Umbuchung / Privat</option>
            </Select>
          </Field>
          <Field label="Buchungskonto">
            <Select value={accountCode} onChange={(event) => selectAccount(event.target.value)}>
              {accounts.map((account) => (
                <option key={account.code} value={account.code}>
                  {account.code} · {account.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Zahlungsweg">
            <Select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>
              <option value="cash">Bar / Kasse</option>
              <option value="bank">Bank</option>
              <option value="card">Karte / Geldtransit</option>
              <option value="paypal">PayPal</option>
            </Select>
          </Field>
          <Field label="Steuersatz">
            <Select
              value={differential ? 0 : taxRate}
              disabled={differential}
              onChange={(event) => setTaxRate(Number(event.target.value) as 0 | 7 | 19)}
            >
              <option value={0}>0 %</option>
              <option value={7}>7 %</option>
              <option value={19}>19 %</option>
            </Select>
          </Field>
          <Field label="Importstatus">
            <div className="input">
              {entry.sourceId?.startsWith("kas:") ? <Badge tone="success">KAS-Import</Badge> : <Badge>Importiert</Badge>}
            </div>
          </Field>
        </div>
        <div className="calculation-box">
          <h3>Kontrollvorschau</h3>
          <div><span>Konto</span><strong>{selectedAccount ? `${selectedAccount.code} · ${selectedAccount.label}` : "Nicht zugeordnet"}</strong></div>
          <div><span>Brutto</span><strong>{formatCurrency(gross)}</strong></div>
          <div><span>Enthaltene Steuer</span><strong>{formatCurrency(estimatedTax)}</strong></div>
          <div><span>Kassenwirkung</span><strong>{paymentMethod !== "cash" || direction === "transfer" ? "0,00 € / bestehende Umbuchung" : `${direction === "income" ? "+" : "−"}${formatCurrency(gross)}`}</strong></div>
        </div>
      </div>
    </Modal>
  );
}
