"use client";

import { useMemo, useState } from "react";
import { BOOKING_CATEGORIES } from "@/lib/accounts";
import { formatCurrency } from "@/lib/accounting";
import { reviewBankTransaction } from "@/lib/bank-statement";
import { useKassenStore } from "@/lib/store";
import type { ImportedTransaction, LedgerDirection, PaymentMethod } from "@/lib/types";
import { Badge, Button, Field, Input, Modal, Select } from "../ui";

export function BankTransactionReviewModal({
  transaction,
  onClose,
  onSaved,
}: {
  transaction?: ImportedTransaction;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  return transaction ? (
    <BankTransactionReviewForm
      key={transaction.id}
      transaction={transaction}
      onClose={onClose}
      onSaved={onSaved}
    />
  ) : null;
}

function BankTransactionReviewForm({
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
  const [description, setDescription] = useState(
    ledgerEntry?.description || transaction.counterparty || transaction.description,
  );
  const [accountCode, setAccountCode] = useState(
    ledgerEntry?.accountCode || transaction.suggestedAccountCode || "0000",
  );
  const [taxRate, setTaxRate] = useState<0 | 7 | 19>(
    ledgerEntry?.taxRate === 7 ? 7 : ledgerEntry?.taxRate === 19 ? 19 : 0,
  );
  const [direction, setDirection] = useState<LedgerDirection>(
    ledgerEntry?.direction || (transaction.amount >= 0 ? "income" : "expense"),
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    ledgerEntry?.paymentMethod || "bank",
  );
  const [error, setError] = useState("");

  const accountOptions = useMemo(
    () => BOOKING_CATEGORIES.filter((account) =>
      direction === "income"
        ? account.side === "in" || account.code === "0000" || account.code === "4610"
        : direction === "expense"
          ? account.side === "out" || account.code === "0000"
          : account.side === "neutral",
    ),
    [direction],
  );
  const selectedAccount = BOOKING_CATEGORIES.find((account) => account.code === accountCode);
  const amount = Math.abs(transaction.amount);
  const taxAmount = taxRate ? Math.round(amount * taxRate / (100 + taxRate) * 100) / 100 : 0;

  function selectAccount(code: string) {
    setAccountCode(code);
    const account = BOOKING_CATEGORIES.find((item) => item.code === code);
    if (account) setTaxRate(account.vat);
  }

  function save() {
    setError("");
    try {
      replaceState(reviewBankTransaction(state, transaction.id, {
        description,
        accountCode,
        taxRate,
        direction,
        paymentMethod,
      }));
      onSaved(`${transaction.counterparty || "Bankbuchung"} wurde geprüft und auf ${accountCode} gebucht.`);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Die Bankbuchung konnte nicht gespeichert werden.");
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Bankbuchung prüfen"
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Abbrechen</Button>
          <Button onClick={save}>Prüfung speichern</Button>
        </>
      }
    >
      <div className="form-stack">
        <div className="alert alert-warning">
          Der Kontoauszug bestätigt die Zahlung, ist aber normalerweise kein Lieferantenbeleg. Vorsteuer erst nach Prüfung der Rechnung auswählen.
        </div>
        {error ? <div className="alert alert-danger">{error}</div> : null}
        <div className="form-grid two">
          <Field label="Gegenpartei"><div className="input">{transaction.counterparty || "Bank"}</div></Field>
          <Field label="Bankbetrag"><div className="input">{transaction.amount >= 0 ? "+" : "−"}{formatCurrency(amount)}</div></Field>
          <Field label="Buchungstext"><Input value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
          <Field label="Vorgang">
            <Select value={direction} onChange={(event) => setDirection(event.target.value as LedgerDirection)}>
              <option value="expense">Ausgabe</option>
              <option value="income">Einnahme / Erstattung</option>
              <option value="transfer">Umbuchung / Privat</option>
            </Select>
          </Field>
          <Field label="Buchungskonto">
            <Select value={accountCode} onChange={(event) => selectAccount(event.target.value)}>
              {accountOptions.map((account) => <option key={account.code} value={account.code}>{account.code} · {account.label}</option>)}
            </Select>
          </Field>
          <Field label="Zahlungsweg">
            <Select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>
              <option value="bank">Bank</option>
              <option value="paypal">PayPal</option>
              <option value="card">Karte</option>
              <option value="cash">Bar</option>
            </Select>
          </Field>
          <Field label="Steuersatz">
            <Select value={taxRate} onChange={(event) => setTaxRate(Number(event.target.value) as 0 | 7 | 19)}>
              <option value={0}>0 % / Rechnung noch nicht geprüft</option>
              <option value={7}>7 %</option>
              <option value={19}>19 %</option>
            </Select>
          </Field>
          <Field label="Status"><div className="input"><Badge tone={transaction.bookkeepingStatus === "reviewed" ? "success" : "warning"}>{transaction.bookkeepingStatus === "reviewed" ? "Geprüft" : "Gebucht · prüfen"}</Badge></div></Field>
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
