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
import { Button, Field, Input, Modal, Select } from "../ui";

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
    <PayPalReviewForm transaction={transaction} onClose={onClose} onSaved={onSaved} />
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
  const internal = isInternalTransfer(transaction);
  const [direction, setDirection] = useState<LedgerDirection>(transaction.amount >= 0 ? "income" : "expense");
  const [accountCode, setAccountCode] = useState(direction === "income" ? "8400" : "4970");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("paypal");
  const [amount, setAmount] = useState(formatMoneyInput(Math.abs(transaction.amount)));
  const [taxRate, setTaxRate] = useState<number>(direction === "income" ? 19 : 0);
  const [description, setDescription] = useState(transaction.description || transaction.counterparty || "PayPal-Umsatz");
  const accountOptions = useMemo(() => BOOKING_CATEGORIES.filter((account) => direction === "income" ? account.side === "in" || account.code === accountCode : direction === "expense" ? account.side === "out" || account.code === accountCode : account.side === "neutral" || account.code === accountCode), [accountCode, direction]);

  function save() {
    try {
      const result = reviewPayPalTransaction(state, transaction.id, {
        direction,
        accountCode,
        paymentMethod,
        amount: parseDecimal(amount),
        taxRate,
        description,
      });
      replaceState(result.state);
      onSaved(`PayPal-Zahlung wurde geprüft und auf ${accountCode} gebucht.`);
      onClose();
    } catch (cause) {
      onSaved(cause instanceof Error ? cause.message : "PayPal-Zahlung konnte nicht geprüft werden.");
    }
  }

  return <Modal open title="Zahlungsdienstleister prüfen" onClose={onClose} wide footer={<><Button variant="secondary" onClick={onClose}>Abbrechen</Button>{!internal ? <Button onClick={save}>Prüfung speichern</Button> : null}</>}>
    {internal ? <div className="alert alert-info">Diese Zahlung ist eine interne Umbuchung zwischen Bank und Zahlungsdienstleister. Sie erzeugt keine neue Einnahme oder Ausgabe.</div> : null}
    <div className="calculation-box"><h3>Umsatz</h3><div><span>Betrag</span><strong>{formatCurrency(transaction.amount)}</strong></div><div><span>Gegenpartei</span><strong>{transaction.counterparty || "-"}</strong></div><div><span>Referenz</span><strong>{transaction.externalId || "-"}</strong></div></div>
    {!internal ? <div className="form-grid two"><Field label="Art"><Select value={direction} onChange={(event) => setDirection(event.target.value as LedgerDirection)}><option value="income">Einnahme</option><option value="expense">Ausgabe</option><option value="transfer">Umbuchung</option></Select></Field><Field label="Konto"><Select value={accountCode} onChange={(event) => setAccountCode(event.target.value)}>{accountOptions.map((account) => <option key={account.code} value={account.code}>{account.code} · {account.label}</option>)}</Select></Field><Field label="Zahlungsart"><Select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}><option value="paypal">PayPal</option><option value="bank">Bank</option><option value="card">Karte</option><option value="cash">Bar</option></Select></Field><Field label="Betrag"><Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></Field><Field label="MwSt."><Select value={taxRate} onChange={(event) => setTaxRate(Number(event.target.value))}><option value={19}>19 %</option><option value={7}>7 %</option><option value={0}>0 %</option></Select></Field><Field label="Text"><Input value={description} onChange={(event) => setDescription(event.target.value)} /></Field></div> : null}
  </Modal>;
}

function formatMoneyInput(value: number): string {
  return new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}
