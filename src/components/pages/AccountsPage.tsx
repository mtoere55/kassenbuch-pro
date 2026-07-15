"use client";

import { useMemo, useState } from "react";
import { formatCurrency, formatDate } from "@/lib/accounting";
import { bankTransactionKindLabel, isBankInternalTransaction } from "@/lib/bank-statement";
import { isInternalTransfer, preparePayPalBookkeeping } from "@/lib/paypal-bookkeeping";
import { useKassenStore } from "@/lib/store";
import { reconcileImportedState } from "@/lib/transaction-reconciliation";
import type { BusinessDocument, ImportedTransaction, ImportedTransactionType, PageKey } from "@/lib/types";
import { Badge, Button, Card, EmptyState, PageHeader, StatCard } from "../ui";
import { BankTransactionReviewModal } from "./BankTransactionReviewModal";
import { PayPalTransactionReviewModal } from "./PayPalTransactionReviewModal";

export function AccountsPage({ onNavigate }: { onNavigate: (page: PageKey) => void }) {
  const { state, replaceState } = useKassenStore();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const selectedTransaction = state.importedTransactions.find((item) => item.id === selectedId);

  function reconcile() {
    const result = reconcileImportedState(state);
    replaceState(result.state);
    setError("");
    setMessage(result.matched ? `${result.matched} Umsätze wurden sicher mit Dokumenten und Buchungen abgeglichen.` : "Keine weiteren eindeutigen Treffer gefunden. Offene Umsätze bleiben zur Prüfung markiert.");
  }

  function prepareBookkeeping() {
    const providerCount = state.importedTransactions.filter((item) => item.accountType === "paypal").length;
    if (!providerCount) {
      setError("Bitte zuerst einen Zahlungsdienstleister-CSV über Datenimport importieren.");
      return;
    }
    const result = preparePayPalBookkeeping(state);
    replaceState(result.state);
    setError("");
    setMessage(
      `${result.createdEntries} Buchung(en) wurden erstellt, ${result.linkedEntries} vorhandene Belegbuchung(en) verbunden und ` +
        `${result.transferEntries} interne Umbuchung(en) erkannt. ${result.reviewCount} Zahlung(en) müssen noch anhand der Rechnung geprüft werden.` +
        (result.feeEntries ? ` ${result.feeEntries} Gebühr(en) wurden auf 4970 gebucht.` : ""),
    );
  }

  const bank = state.importedTransactions.filter((item) => item.accountType === "bank");
  const bankCount = bank.length;
  const bankBooked = bank.filter((item) => item.bookkeepingStatus === "booked" || item.bookkeepingStatus === "reviewed").length;
  const bankReview = bank.filter((item) => item.bookkeepingStatus === "booked" || item.status === "needsReview").length;
  const provider = state.importedTransactions.filter((item) => item.accountType === "paypal");
  const providerCount = provider.length;
  const providerInternal = provider.filter(isInternalTransfer).length;
  const providerMatched = provider.filter((item) => item.status === "matched").length;
  const providerBooked = provider.filter((item) => item.bookkeepingStatus === "booked" || item.bookkeepingStatus === "reviewed").length;
  const providerReviewed = provider.filter((item) => item.bookkeepingStatus === "reviewed").length;
  const providerFees = provider.reduce((sum, item) => sum + (item.feeAmount || 0), 0);
  const sortedTransactions = useMemo(() => [...state.importedTransactions].sort((left, right) => `${right.date}|${right.time || ""}`.localeCompare(`${left.date}|${left.time || ""}`)), [state.importedTransactions]);

  return <div>
    <PageHeader title="Bank & Zahlungsabgleich" subtitle="Kontoauszüge, Zahlungsdienstleister-CSV und Monatsberichte werden ausschließlich über Datenimport hochgeladen und hier geprüft." actions={<div className="document-actions"><Button onClick={() => onNavigate("scan")}>Datenimport öffnen</Button><Button variant="secondary" onClick={reconcile}>Automatisch abgleichen</Button><Button variant="secondary" onClick={prepareBookkeeping}>Zahlungsdienstleister buchen</Button></div>} />
    {message ? <div className="alert alert-success">{message}</div> : null}
    {error ? <div className="alert alert-danger">{error}</div> : null}
    <div className="stat-grid"><StatCard label="Bankbewegungen" value={String(bankCount)} detail={`${bankBooked} gebucht · ${bankReview} prüfen`} /><StatCard label="Zahlungsdienstleister" value={String(providerCount)} tone="blue" detail={`${providerInternal} interne Umbuchungen`} /><StatCard label="Gebucht" value={String(providerBooked)} tone="positive" detail={`${providerReviewed} geprüft`} /><StatCard label="Gebühren" value={formatCurrency(providerFees)} tone="negative" detail={`${providerMatched} zugeordnet`} /></div>
    <Card>
      <div className="card-heading"><div><h2>Kontobewegungen</h2><p>Auszahlungen, Bargeldeinzahlungen und Zahlungsdienstleister-Bankbewegungen werden als Umbuchungen behandelt, nicht als doppelte Einnahmen oder Ausgaben.</p></div></div>
      {sortedTransactions.length === 0 ? <EmptyState icon="accounts" title="Noch keine Kontobewegungen" text="Kontoauszüge und Zahlungsdienstleister-Dateien werden im zentralen Datenimport hochgeladen." /> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Datum</th><th>Konto</th><th>Art</th><th>Gegenpartei / Beschreibung</th><th>Rechnung / Treffer</th><th>Abgleich</th><th>Buchhaltung</th><th>Gebühr</th><th className="align-right">Betrag</th></tr></thead><tbody>{sortedTransactions.map((item) => <TransactionRow key={item.id} item={item} document={state.documents.find((document) => document.id === item.matchedDocumentId)} onReview={() => setSelectedId(item.id)} />)}</tbody></table></div>}
    </Card>
    <div className="alert alert-info">Hinweis: Kontoauszüge liefern oft keine sichere Vorsteuer. Lieferantenzahlungen bleiben deshalb zur Prüfung markiert, bis die passende Rechnung über Datenimport oder Dokumente kontrolliert wurde.</div>
    <PayPalTransactionReviewModal transaction={selectedTransaction?.accountType === "paypal" ? selectedTransaction : undefined} onClose={() => setSelectedId(undefined)} onSaved={setMessage} />
    <BankTransactionReviewModal transaction={selectedTransaction?.accountType === "bank" ? selectedTransaction : undefined} onClose={() => setSelectedId(undefined)} onSaved={setMessage} />
  </div>;
}

function TransactionRow({ item, document, onReview }: { item: ImportedTransaction; document?: BusinessDocument; onReview: () => void }) {
  const providerInternal = item.accountType === "paypal" && isInternalTransfer(item);
  const bankInternal = isBankInternalTransaction(item);
  const internal = providerInternal || bankInternal;
  const canReview = Boolean(item.matchedLedgerEntryId) && !internal && item.bookkeepingStatus !== "reviewed";
  const bookkeepingLabel = item.bookkeepingStatus === "reviewed" ? "Geprüft" : item.bookkeepingStatus === "booked" ? "Gebucht · prüfen" : internal ? "Umbuchung" : "Noch nicht gebucht";
  return <tr><td>{formatDate(item.date)}<small>{item.time || ""}</small></td><td><Badge tone={item.accountType === "paypal" ? "info" : "neutral"}>{item.accountType === "paypal" ? "Dienstleister" : "Bank"}</Badge></td><td><Badge tone={internal ? "info" : item.transactionType === "refund" ? "warning" : "neutral"}>{item.accountType === "bank" ? bankTransactionKindLabel(item) : transactionTypeLabel(item.transactionType)}</Badge></td><td><strong>{item.counterparty || item.description}</strong><small>{item.counterparty ? item.description.split(" · ")[0] : item.externalId || "Keine externe Referenz"}</small></td><td><strong>{document?.documentNumber || item.invoiceNumber || "–"}</strong><small>{document ? `${documentTypeLabel(document)} · ${item.matchConfidence}%` : item.relatedExternalId || item.externalId || ""}</small></td><td><Badge tone={item.status === "matched" ? "success" : item.status === "needsReview" ? "warning" : item.status === "ignored" ? "info" : "neutral"}>{statusLabel(item, internal)}</Badge></td><td><div className="document-actions"><Badge tone={item.bookkeepingStatus === "reviewed" ? "success" : item.bookkeepingStatus === "booked" ? "warning" : internal ? "info" : "neutral"}>{bookkeepingLabel}</Badge>{canReview ? <Button variant="secondary" onClick={onReview}>Prüfen</Button> : null}</div></td><td>{item.feeAmount ? formatCurrency(item.feeAmount) : "–"}</td><td className={`align-right ${item.amount >= 0 ? "money-positive" : "money-negative"}`}><strong>{item.amount >= 0 ? "+" : "−"}{formatCurrency(Math.abs(item.amount))}</strong><small>{item.currency || "EUR"}</small></td></tr>;
}

function transactionTypeLabel(type?: ImportedTransactionType) { return ({ payment: "Zahlung", refund: "Rückzahlung", bankFunding: "Bank → Dienstleister", bankWithdrawal: "Dienstleister → Bank", fee: "Gebühr", other: "Umsatz" } as const)[type || "other"]; }
function statusLabel(item: ImportedTransaction, internal: boolean) { if (internal) return "Umbuchung"; return item.status === "matched" ? "Zugeordnet" : item.status === "needsReview" ? "Prüfen" : item.status === "ignored" ? "Ignoriert" : "Neu"; }
function documentTypeLabel(document: BusinessDocument) { return document.type === "invoice" ? "Rechnung" : document.type === "receipt" ? "Quittung" : document.type === "estimate" ? "Kostenvoranschlag" : document.type === "purchaseContract" ? "Ankaufvertrag" : document.type === "zReport" ? "Tagesabschluss" : "Eingangsrechnung"; }
