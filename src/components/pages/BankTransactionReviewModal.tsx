"use client";

import { useMemo, useState } from "react";
import { BOOKING_CATEGORIES } from "@/lib/accounts";
import { formatCurrency } from "@/lib/accounting";
import { reviewBankTransaction } from "@/lib/bank-statement";
import {
  createLearnedBookingRule,
  upsertLearnedBookingRule,
} from "@/lib/learned-booking-rules";
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
  const initialDirection = ledgerEntry?.direction || (transaction.amount >= 0 ? "income" : "expense");
  const initialAccount = ledgerEntry?.accountCode || transaction.suggestedAccountCode || "0000";
  const unresolved = initialAccount === "0000";
  const [description, setDescription] = useState(
    ledgerEntry?.description || transaction.counterparty || transaction.description,
  );
  const [accountCode, setAccountCode] = useState(initialAccount);
  const [taxRate, setTaxRate] = useState<0 | 7 | 19>(
    ledgerEntry?.taxRate === 7 ? 7 : ledgerEntry?.taxRate === 19 ? 19 : 0,
  );
  const [direction, setDirection] = useState<LedgerDirection>(initialDirection);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    ledgerEntry?.paymentMethod || "bank",
  );
  const [rememberRule, setRememberRule] = useState(unresolved);
  const [ruleKeyword, setRuleKeyword] = useState(
    transaction.counterparty || transaction.description.split(" · ").at(-1)?.trim() || "",
  );
  const [documentRequired, setDocumentRequired] = useState(initialDirection !== "transfer");
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

  function changeDirection(value: LedgerDirection) {
    setDirection(value);
    if (value === "transfer") {
      setTaxRate(0);
      setDocumentRequired(false);
    }
  }

  function save() {
    setError("");
    try {
      let nextState = reviewBankTransaction(state, transaction.id, {
        description,
        accountCode,
        taxRate,
        direction,
        paymentMethod,
      });
      let ruleMessage = "";
      if (rememberRule) {
        const rule = createLearnedBookingRule(transaction, {
          keyword: ruleKeyword,
          label: description,
          accountCode,
          direction,
          paymentMethod,
          taxRate,
          documentRequired,
        });
        nextState = upsertLearnedBookingRule(nextState, rule);
        ruleMessage = ` Die Regel „${rule.keyword}“ wurde für zukünftige ${rule.amountDirection === "incoming" ? "Gutschriften" : "Belastungen"} gespeichert.`;
      }
      replaceState(nextState);
      onSaved(`${transaction.counterparty || "Bankbuchung"} wurde auf ${accountCode} zugeordnet.${ruleMessage}`);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Die Bankbuchung konnte nicht gespeichert werden.");
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Bankbuchung zuordnen"
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Abbrechen</Button>
          <Button onClick={save}>Zuordnung speichern</Button>
        </>
      }
    >
      <div className="form-stack">
        <div className="alert alert-warning">
          Das Buchungskonto kann sofort festgelegt und für die Zukunft gespeichert werden. Vorsteuer wird nur mit einem passenden Lieferantenbeleg übernommen.
        </div>
        {error ? <div className="alert alert-danger">{error}</div> : null}
        <div className="form-grid two">
          <Field label="Gegenpartei"><div className="input">{transaction.counterparty || "Bank"}</div></Field>
          <Field label="Bankbetrag"><div className="input">{transaction.amount >= 0 ? "+" : "−"}{formatCurrency(amount)}</div></Field>
          <Field label="Buchungstext"><Input value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
          <Field label="Vorgang">
            <Select value={direction} onChange={(event) => changeDirection(event.target.value as LedgerDirection)}>
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
              <option value="card">Karte / Flatpay</option>
              <option value="cash">Bar</option>
            </Select>
          </Field>
          <Field label="Steuersatz">
            <Select value={taxRate} onChange={(event) => setTaxRate(Number(event.target.value) as 0 | 7 | 19)}>
              <option value={0}>0 % / kein Steuerbetrag</option>
              <option value={7}>7 %</option>
              <option value={19}>19 %</option>
            </Select>
          </Field>
          <Field label="Status"><div className="input"><Badge tone={unresolved ? "warning" : "success"}>{unresolved ? "Regel erforderlich" : transaction.bookkeepingStatus === "reviewed" ? "Zugeordnet" : "Beleg / Konto ergänzen"}</Badge></div></Field>
        </div>

        <div className="card-subsection">
          <label className="checkbox-row">
            <input type="checkbox" checked={rememberRule} onChange={(event) => setRememberRule(event.target.checked)} />
            <span><strong>Diese Zuordnung für zukünftige Bewegungen merken</strong><small>Gleiche Gegenpartei und gleiche Betragsrichtung werden künftig automatisch kontiert.</small></span>
          </label>
          {rememberRule ? (
            <div className="form-grid two">
              <Field label="Regelschlüssel"><Input value={ruleKeyword} onChange={(event) => setRuleKeyword(event.target.value)} placeholder="z. B. Lieferantenname" /></Field>
              <Field label="Belegpflicht">
                <label className="checkbox-row input">
                  <input type="checkbox" checked={documentRequired} onChange={(event) => setDocumentRequired(event.target.checked)} />
                  <span>Beleg später zuordnen</span>
                </label>
              </Field>
            </div>
          ) : null}
        </div>

        <div className="calculation-box">
          <h3>Kontrollvorschau</h3>
          <div><span>Konto</span><strong>{selectedAccount ? `${selectedAccount.code} · ${selectedAccount.label}` : "Nicht zugeordnet"}</strong></div>
          <div><span>Brutto</span><strong>{formatCurrency(amount)}</strong></div>
          <div><span>Enthaltene Steuer</span><strong>{formatCurrency(taxAmount)}</strong></div>
          <div><span>Netto</span><strong>{formatCurrency(amount - taxAmount)}</strong></div>
          {rememberRule && documentRequired ? <p className="form-hint">Für zukünftige Bewegungen wird das Konto automatisch gesetzt; die Steuer bleibt bis zum Beleg bei 0 €.</p> : null}
        </div>
      </div>
    </Modal>
  );
}
