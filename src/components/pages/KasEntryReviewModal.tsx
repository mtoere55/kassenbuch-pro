"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { formatCurrency, formatDate } from "@/lib/accounting";
import {
  parseCashbookBackup,
  planBackupImport,
  type CashbookBackup,
} from "@/lib/backup-reader";
import {
  buildReviewAccountOptions,
  correctKasEntry,
  isUnresolvedKasEntry,
} from "@/lib/kas-review";
import { parseDecimal } from "@/lib/invoice-validation";
import { useKassenStore } from "@/lib/store";
import type { LedgerDirection, LedgerEntry, PaymentMethod } from "@/lib/types";
import { Badge, Button, Field, Input, Modal, Select } from "../ui";

export function KasBackupImportModal({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (message: string) => void;
}) {
  const { state, replaceState } = useKassenStore();
  const [backup, setBackup] = useState<CashbookBackup>();
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const plan = useMemo(
    () => (backup ? planBackupImport(backup, state.ledger, fileName || "Kassenbuch-Backup") : undefined),
    [backup, fileName, state.ledger],
  );
  const categoryNames = useMemo(
    () => new Map(backup?.categories.map((category) => [category.code, category.name]) ?? []),
    [backup],
  );

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setBackup(undefined);
    setFileName(file.name);
    setReading(true);
    try {
      if (!file.name.toLowerCase().endsWith(".kas")) {
        throw new Error("Bitte eine Datei mit der Endung .kas auswählen.");
      }
      setBackup(parseCashbookBackup(await file.arrayBuffer()));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Die KAS-Datei konnte nicht gelesen werden.");
    } finally {
      setReading(false);
    }
  }

  function importEntries() {
    if (!backup || !plan?.entries.length) return;
    replaceState({ ...state, ledger: [...plan.entries, ...state.ledger] });
    onImported(
      `${plan.entries.length} Buchung(en) aus ${fileName} wurden übernommen.${plan.duplicateCount ? ` ${plan.duplicateCount} bereits vorhandene Buchung(en) wurden übersprungen.` : ""}`,
    );
    setBackup(undefined);
    setFileName("");
    setError("");
    onClose();
  }

  function close() {
    setError("");
    onClose();
  }

  const sample = backup?.transactions.slice(0, 8) ?? [];

  return (
    <Modal
      open={open}
      title="KAS-Backup importieren"
      onClose={close}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={close}>Abbrechen</Button>
          <Button disabled={!plan?.entries.length || reading} onClick={importEntries}>
            {plan?.entries.length ? `${plan.entries.length} Buchungen übernehmen` : "Keine neuen Buchungen"}
          </Button>
        </>
      }
    >
      <div className="form-stack">
        <div className="alert alert-info">
          Die Datei wird ausschließlich lokal im Browser gelesen. Das Original bleibt unverändert auf deinem Gerät.
        </div>
        <Field label="KAS-Datei" hint={fileName || "Altes Kassenbuch-Backup auswählen"}>
          <Input type="file" accept=".kas,application/octet-stream" onChange={selectFile} />
        </Field>
        {reading ? <div className="alert alert-info">Backup wird geprüft …</div> : null}
        {error ? <div className="alert alert-danger">{error}</div> : null}

        {backup && plan ? (
          <>
            <div className="calculation-box">
              <h3>Prüfergebnis</h3>
              <div><span>Datei</span><strong>{fileName}</strong></div>
              <div><span>Gefundene Buchungen</span><strong>{backup.transactions.length}</strong></div>
              <div><span>Erkannte Konten</span><strong>{backup.categories.length}</strong></div>
              <div><span>Zeitraum</span><strong>{backup.startDate && backup.endDate ? `${formatDate(backup.startDate)} – ${formatDate(backup.endDate)}` : "–"}</strong></div>
              <div><span>Einnahmen</span><strong>{formatCurrency(backup.incomeTotal)}</strong></div>
              <div><span>Ausgaben</span><strong>{formatCurrency(backup.expenseTotal)}</strong></div>
              <div><span>Neu zu importieren</span><strong>{plan.entries.length}</strong></div>
              <div><span>Bereits vorhanden</span><strong>{plan.duplicateCount}</strong></div>
            </div>

            {plan.unknownCategoryCount ? (
              <div className="alert alert-warning">
                {plan.unknownCategoryCount} Buchung(en) haben im alten Backup keine Kontenzuordnung. Sie werden als Konto 0000 importiert und können danach einzeln geprüft werden.
              </div>
            ) : null}
            {backup.warnings.length ? (
              <div className="alert alert-warning">
                {backup.warnings.length} beschädigte oder unbekannte Datenblöcke werden übersprungen.
              </div>
            ) : null}

            <div className="card-heading">
              <div><h3>Vorschau</h3><p>Die ersten {sample.length} Buchungen aus der Datei.</p></div>
              <div className="badge-row">
                <Badge tone="success">{plan.entries.length} neu</Badge>
                {plan.duplicateCount ? <Badge tone="warning">{plan.duplicateCount} vorhanden</Badge> : null}
              </div>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Datum</th><th>Beleg</th><th>Text</th><th>Konto</th><th>MwSt.</th><th className="align-right">Betrag</th></tr></thead>
                <tbody>
                  {sample.map((transaction) => (
                    <tr key={transaction.recordId}>
                      <td>{formatDate(transaction.date)}</td>
                      <td>{transaction.sequence ? `KAS-${transaction.sequence}` : `KAS-${transaction.recordId}`}</td>
                      <td>{transaction.description || "–"}</td>
                      <td><strong>{transaction.categoryCode || "0000"}</strong><small>{categoryNames.get(transaction.categoryCode) || "Nicht zugeordnet"}</small></td>
                      <td>{transaction.taxRate ? `${transaction.taxRate} %` : "–"}</td>
                      <td className={`align-right ${transaction.signedAmount >= 0 ? "money-positive" : "money-negative"}`}>
                        <strong>{transaction.signedAmount >= 0 ? "+" : "−"}{formatCurrency(Math.abs(transaction.signedAmount))}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

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
