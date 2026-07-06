"use client";

import { useMemo, useState } from "react";
import { BOOKING_CATEGORIES } from "@/lib/accounts";
import { formatCurrency } from "@/lib/accounting";
import { parseDecimal } from "@/lib/invoice-validation";
import {
  isInternalTransfer,
  reviewPayPalTransaction,
} from "@/lib/paypal-bookkeeping";
import { useKassenStore } from "@/lib/store";
import type { ImportedTransaction, LedgerDirection, PaymentMethod } from "@/lib/types";
import { Badge, Button, Field, Input, Modal, Select } from "../ui";

export function PayPalTransactionReviewModal({
  transaction,
  onClose,
  onSaved,
}: {
  transaction?: ImportedTransaction;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  return transaction ? (
    <PayPalReviewForm
      key={transaction.id}
      transaction={transaction}
      onClose={onClose}
      onSaved={onSaved}
    />
  ) : null;
}

function PayPalReviewForm({
  transaction,
  onClose,
  onSaved,
}: {
  transaction: ImportedTransaction;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { state, replaceState } = useKassenStore();
  const ledgerEntry = transaction.matchedLedgerEntryId
    ? state.ledger.find((entry) => entry.id === transaction.matchedLedgerEntryId)
    : undefined;
  const initialDirection: LedgerDirection =
    ledgerEntry?.direction ||
    (transaction.transactionType === "refund" || transaction.amount > 0 ? "income" : "expense");
  const [description, setDescription] = useState(
    ledgerEntry?.description || transaction.counterparty || transaction.description,
  );
  const [accountCode, setAccountCode] = useState(
    ledgerEntry?.accountCode || transaction.suggestedAccountCode || "0000",
  );
  const [taxRate, setTaxRate] = useState<0 | 7 | 19>(
    ledgerEntry?.taxRate === 7 ? 7 : ledgerEntry?.taxRate === 19 ? 19 : 0,
  );
  const [direction, setDirection] = useState<LedgerDirection>(initialDirection);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    ledgerEntry?.paymentMethod || "paypal",
  );
  const [error, setError] = useState("");

  const accountOptions = useMemo(() => {
    if (direction === "income") {
      return BOOKING_CATEGORIES.filter(
        (account) => account.side === "in" || ["3200", "3400", "4610", "4930", "4980"].includes(account.code),
      );
    }
    return BOOKING_CATEGORIES.filter((account) => account.side === "out" || account.code === "0000");
  }, [direction]);
  const selectedAccount = BOOKING_CATEGORIES.find((account) => account.code === accountCode);
  const differential = ["3290", "8336", "8390"].includes(accountCode);
  const amount = Math.abs(transaction.grossAmount ?? transaction.amount);
  const taxAmount = differential || taxRate === 0
    ? 0
    : Math.round(parseDecimal(String(amount)) * taxRate / (100 + taxRate) * 100) / 100;

  function changeAccount(code: string) {
    setAccountCode(code);
    const account = BOOKING_CATEGORIES.find((item) => item.code === code);
    if (account) setTaxRate(account.vat);
  }

  function save() {
    setError("");
    try {
      const next = reviewPayPalTransaction(state, transaction.id, {
        description,
        accountCode,
        taxRate: differential ? 0 : taxRate,
        direction,
        paymentMethod,
      });
      replaceState(next);
      onSaved(
        `${transaction.counterparty || transaction.description} wurde geprüft und auf ${accountCode} gebucht.`,
      );
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Die PayPal-Buchung konnte nicht gespeichert werden.");
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="PayPal-Buchung prüfen"
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Abbrechen</Button>
          <Button onClick={save}>Prüfung speichern</Button>
        </>
      }
    >
      <div className="form-stack">
        {isInternalTransfer(transaction) ? (
          <div className="alert alert-info">Diese Zeile ist eine interne Umbuchung und keine Einnahme oder Ausgabe.</div>
        ) : (
          <div className="alert alert-warning">
            PayPal liefert keine verlässliche Vorsteuer. Steuersatz und Konto dürfen erst nach Prüfung der Rechnung bestätigt werden.
          </div>
        )}
        {error ? <div className="alert alert-danger">{error}</div> : null}
        <div className="form-grid two">
          <Field label="Gegenpartei">
            <div className="input">{transaction.counterparty || "PayPal"}</div>
          </Field>
          <Field label="Betrag">
            <div className="input">{formatCurrency(amount)}</div>
          </Field>
          <Field label="Text">
            <Input value={description} onChange={(event) => setDescription(event.target.value)} />
          </Field>
          <Field label="Vorgang">
            <Select value={direction} onChange={(event) => setDirection(event.target.value as LedgerDirection)}>
              <option value="expense">Ausgabe</option>
              <option value="income">Einnahme / Erstattung</option>
            </Select>
          </Field>
          <Field label="Buchungskonto">
            <Select value={accountCode} onChange={(event) => changeAccount(event.target.value)}>
              {accountOptions.map((account) => (
                <option key={account.code} value={account.code}>
                  {account.code} · {account.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Zahlungsweg">
            <Select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>
              <option value="paypal">PayPal</option>
              <option value="bank">Bank</option>
              <option value="card">Karte</option>
              <option value="cash">Bar</option>
            </Select>
          </Field>
          <Field label="Steuersatz">
            <Select
              value={differential ? 0 : taxRate}
              disabled={differential}
              onChange={(event) => setTaxRate(Number(event.target.value) as 0 | 7 | 19)}
            >
              <option value={0}>0 % / noch nicht geprüft</option>
              <option value={7}>7 %</option>
              <option value={19}>19 %</option>
            </Select>
          </Field>
          <Field label="Rechnung / Referenz">
            <div className="input">{transaction.invoiceNumber || transaction.externalId || "–"}</div>
          </Field>
        </div>
        <div className="calculation-box">
          <h3>Kontrollvorschau</h3>
          <div><span>Konto</span><strong>{selectedAccount ? `${selectedAccount.code} · ${selectedAccount.label}` : "Nicht zugeordnet"}</strong></div>
          <div><span>Brutto</span><strong>{formatCurrency(amount)}</strong></div>
          <div><span>Enthaltene Steuer</span><strong>{formatCurrency(taxAmount)}</strong></div>
          <div><span>Netto</span><strong>{formatCurrency(amount - taxAmount)}</strong></div>
        </div>
      </div>
    </Modal>
  );
}
