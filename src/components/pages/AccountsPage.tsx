"use client";

import { useMemo, useRef, useState } from "react";
import { formatCurrency, formatDate } from "@/lib/accounting";
import { parseTransactionsCsv, summarizeImportedTransactions } from "@/lib/csv";
import { useKassenStore } from "@/lib/store";
import { reconcileImportedState } from "@/lib/transaction-reconciliation";
import type { BusinessDocument, ImportedTransaction, ImportedTransactionType } from "@/lib/types";
import { Icon } from "../Icon";
import { Badge, Button, Card, EmptyState, PageHeader, StatCard } from "../ui";

export function AccountsPage() {
  const { state, importTransactions, replaceState } = useKassenStore();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const bankInput = useRef<HTMLInputElement>(null);
  const paypalInput = useRef<HTMLInputElement>(null);

  async function handleFile(file: File | undefined, type: "bank" | "paypal") {
    if (!file) return;
    setError("");
    setMessage("");
    try {
      const text = await file.text();
      const transactions = parseTransactionsCsv(text, type);
      if (!transactions.length) throw new Error("In der CSV-Datei wurden keine lesbaren Umsätze gefunden.");
      const summary = summarizeImportedTransactions(transactions);
      const added = importTransactions(transactions);
      if (type === "paypal") {
        setMessage(
          `${summary.total} PayPal-Zeilen erkannt, ${added} neu importiert. ` +
            `${summary.paypalPayments} Zahlungen, ${summary.paypalRefunds} Rückzahlungen und ` +
            `${summary.internalTransfers} interne Bankbewegungen.`,
        );
      } else {
        setMessage(`${added} neue Bank-Umsätze importiert.`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Die CSV-Datei konnte nicht importiert werden.");
    }
  }

  function reconcile() {
    const result = reconcileImportedState(state);
    replaceState(result.state);
    setError("");
    setMessage(
      result.matched
        ? `${result.matched} Umsätze wurden sicher mit Dokumenten und Buchungen abgeglichen.`
        : "Keine weiteren eindeutigen Treffer gefunden. Offene Umsätze bleiben zur Prüfung markiert.",
    );
  }

  const bankCount = state.importedTransactions.filter((item) => item.accountType === "bank").length;
  const paypal = state.importedTransactions.filter((item) => item.accountType === "paypal");
  const paypalCount = paypal.length;
  const paypalInternal = paypal.filter(isInternalTransfer).length;
  const paypalMatched = paypal.filter((item) => item.status === "matched").length;
  const paypalReview = paypal.filter((item) => item.status === "needsReview" || item.status === "new").length;
  const paypalFees = paypal.reduce((sum, item) => sum + (item.feeAmount || 0), 0);
  const sortedTransactions = useMemo(
    () => [...state.importedTransactions].sort((left, right) => `${right.date}|${right.time || ""}`.localeCompare(`${left.date}|${left.time || ""}`)),
    [state.importedTransactions],
  );

  return <div>
    <PageHeader
      title="Bank & PayPal"
      subtitle="Kontobewegungen importieren, sicher mit Rechnungen abgleichen und Doppelimporte verhindern."
      actions={<Button onClick={reconcile}>Automatisch abgleichen</Button>}
    />
    {message ? <div className="alert alert-success">{message}</div> : null}
    {error ? <div className="alert alert-danger">{error}</div> : null}
    <div className="account-cards">
      <Card className="account-card">
        <div className="account-logo bank"><Icon name="accounts" width={25} height={25} /></div>
        <div>
          <h2>Geschäftskonto</h2>
          <p>Bis zur Anbieterfreigabe funktioniert der sichere CSV-Import.</p>
          <div className="account-meta"><Badge tone="info">{bankCount} Umsätze</Badge><Badge tone="warning">API noch nicht verbunden</Badge></div>
        </div>
        <Button variant="secondary" icon="upload" onClick={() => bankInput.current?.click()}>Bank-CSV importieren</Button>
        <input ref={bankInput} type="file" accept=".csv,text/csv" hidden onChange={(event) => void handleFile(event.target.files?.[0], "bank")} />
      </Card>
      <Card className="account-card">
        <div className="account-logo paypal">P</div>
        <div>
          <h2>PayPal Business</h2>
          <p>Der PayPal-Aktivitätsbericht wird mit Brutto, Gebühr, Netto, Rechnung und verbundenem Transaktionscode gelesen.</p>
          <div className="account-meta"><Badge tone="info">{paypalCount} Zeilen</Badge><Badge tone="success">{paypalMatched} zugeordnet</Badge><Badge tone="warning">{paypalReview} prüfen</Badge></div>
        </div>
        <Button variant="secondary" icon="upload" onClick={() => paypalInput.current?.click()}>PayPal-CSV importieren</Button>
        <input ref={paypalInput} type="file" accept=".csv,text/csv" hidden onChange={(event) => void handleFile(event.target.files?.[0], "paypal")} />
      </Card>
    </div>
    {paypalCount ? <div className="stat-grid">
      <StatCard label="PayPal-Zeilen" value={String(paypalCount)} detail={`${paypalInternal} interne Umbuchungen`} />
      <StatCard label="Zugeordnet" value={String(paypalMatched)} tone="positive" detail="Dokument und Buchung gefunden" />
      <StatCard label="Noch prüfen" value={String(paypalReview)} tone="negative" detail="Beleg oder Konto fehlt" />
      <StatCard label="PayPal-Gebühren" value={formatCurrency(paypalFees)} tone="blue" detail="Entgelt aus CSV" />
    </div> : null}
    <Card>
      <div className="card-heading"><div><h2>Kontobewegungen</h2><p>Bankgutschriften auf das PayPal-Konto werden als Umbuchung erkannt und nicht als Einnahme behandelt.</p></div></div>
      {sortedTransactions.length === 0 ? (
        <EmptyState icon="accounts" title="Noch keine Kontobewegungen" text="Exportiere bei deiner Bank oder PayPal eine CSV-Datei und importiere sie hier." />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Datum</th><th>Konto</th><th>Art</th><th>Gegenpartei / Beschreibung</th><th>Rechnung / Treffer</th><th>Status</th><th>Gebühr</th><th className="align-right">Betrag</th></tr></thead>
            <tbody>{sortedTransactions.map((item) => (
              <TransactionRow
                key={item.id}
                item={item}
                document={state.documents.find((document) => document.id === item.matchedDocumentId)}
              />
            ))}</tbody>
          </table>
        </div>
      )}
    </Card>
    <div className="alert alert-info">PayPal-Zahlungen werden erst nach eindeutigem Belegabgleich als erledigt markiert. Bank → PayPal und PayPal → Bank bleiben interne Umbuchungen und verändern weder Umsatz noch Betriebsausgaben.</div>
  </div>;
}

function TransactionRow({ item, document }: { item: ImportedTransaction; document?: BusinessDocument }) {
  const internal = isInternalTransfer(item);
  return <tr>
    <td>{formatDate(item.date)}<small>{item.time || ""}</small></td>
    <td><Badge tone={item.accountType === "paypal" ? "info" : "neutral"}>{item.accountType === "paypal" ? "PayPal" : "Bank"}</Badge></td>
    <td><Badge tone={internal ? "info" : item.transactionType === "refund" ? "warning" : "neutral"}>{transactionTypeLabel(item.transactionType)}</Badge></td>
    <td><strong>{item.counterparty || item.description}</strong><small>{item.counterparty ? item.description.split(" · ")[0] : item.externalId || "Keine externe Referenz"}</small></td>
    <td><strong>{document?.documentNumber || item.invoiceNumber || "–"}</strong><small>{document ? `${documentTypeLabel(document)} · ${item.matchConfidence}%` : item.relatedExternalId || item.externalId || ""}</small></td>
    <td><Badge tone={item.status === "matched" ? "success" : item.status === "needsReview" ? "warning" : item.status === "ignored" ? "info" : "neutral"}>{statusLabel(item)}</Badge></td>
    <td>{item.feeAmount ? formatCurrency(item.feeAmount) : "–"}</td>
    <td className={`align-right ${item.amount >= 0 ? "money-positive" : "money-negative"}`}><strong>{item.amount >= 0 ? "+" : "−"}{formatCurrency(Math.abs(item.amount))}</strong><small>{item.currency || "EUR"}</small></td>
  </tr>;
}

function isInternalTransfer(item: ImportedTransaction) {
  return item.transactionType === "bankFunding" || item.transactionType === "bankWithdrawal";
}

function transactionTypeLabel(type?: ImportedTransactionType) {
  return ({
    payment: "Zahlung",
    refund: "Rückzahlung",
    bankFunding: "Bank → PayPal",
    bankWithdrawal: "PayPal → Bank",
    fee: "Gebühr",
    other: "Umsatz",
  } as const)[type || "other"];
}

function statusLabel(item: ImportedTransaction) {
  if (isInternalTransfer(item)) return "Umbuchung";
  return item.status === "matched" ? "Zugeordnet" : item.status === "needsReview" ? "Prüfen" : item.status === "ignored" ? "Ignoriert" : "Neu";
}

function documentTypeLabel(document: BusinessDocument) {
  return ({
    invoice: "Rechnung",
    receipt: "Quittung",
    purchaseContract: "Ankaufvertrag",
    supplierInvoice: "Eingangsrechnung",
    zReport: "Tagesabschluss",
  } as const)[document.type];
}
