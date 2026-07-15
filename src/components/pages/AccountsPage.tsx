"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCurrency, formatDate } from "@/lib/accounting";
import { bankTransactionKindLabel, isBankInternalTransaction } from "@/lib/bank-statement";
import { applyConfiguredBusinessRules } from "@/lib/business-booking-rules";
import { isMalformedLegacyPdfImport } from "@/lib/import-repair";
import { isInternalTransfer, preparePayPalBookkeeping } from "@/lib/paypal-bookkeeping";
import { useKassenStore } from "@/lib/store";
import { reconcileImportedState } from "@/lib/transaction-reconciliation";
import type { BusinessDocument, ImportedTransaction, ImportedTransactionType, LedgerEntry, PageKey } from "@/lib/types";
import { Badge, Button, Card, EmptyState, PageHeader, StatCard } from "../ui";
import { BankTransactionReviewModal } from "./BankTransactionReviewModal";
import { PayPalTransactionReviewModal } from "./PayPalTransactionReviewModal";

export function AccountsPage({ onNavigate }: { onNavigate: (page: PageKey) => void }) {
  const { state, replaceState } = useKassenStore();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const selectedTransaction = state.importedTransactions.find((item) => item.id === selectedId);
  const malformedLegacyImports = state.importedTransactions.filter(isMalformedLegacyPdfImport);

  useEffect(() => {
    const normalized = applyConfiguredBusinessRules(state);
    if (normalized !== state) replaceState(normalized);
  }, [replaceState, state]);

  function reconcile() {
    const result = reconcileImportedState(state);
    replaceState(applyConfiguredBusinessRules(result.state));
    setError("");
    setMessage(result.matched ? `${result.matched} Umsatz/Umsätze wurden mit vorhandenen Dokumenten verbunden. Die betrieblichen Regeln wurden erneut angewendet.` : "Alle bekannten Regeln wurden angewendet. Nur fehlende Belege oder wirklich unbekannte Vorgänge bleiben offen.");
  }

  function removeMalformedLegacyImports() {
    const count = malformedLegacyImports.length;
    if (!count) return;
    const confirmed = window.confirm(
      `${count} fehlerhafte Altimport-Zeile(n) entfernen?\n\nEs werden nur ungebuchte Zeilen entfernt, bei denen eine IBAN fälschlich als extrem hoher Betrag und das Importdatum als Buchungsdatum gespeichert wurde.`,
    );
    if (!confirmed) return;
    replaceState({
      ...state,
      importedTransactions: state.importedTransactions.filter((item) => !isMalformedLegacyPdfImport(item)),
    });
    setError("");
    setMessage(`${count} fehlerhafte Altimport-Zeile(n) wurden entfernt. Der Kontoauszug kann danach über Datenimport erneut eingelesen werden.`);
  }

  function prepareBookkeeping() {
    const providerCount = state.importedTransactions.filter((item) => item.accountType === "paypal").length;
    if (!providerCount) {
      setError("Bitte zuerst einen detaillierten PayPal-Bericht über Datenimport importieren.");
      return;
    }
    const result = preparePayPalBookkeeping(state);
    replaceState(applyConfiguredBusinessRules(result.state));
    setError("");
    setMessage(
      `${result.createdEntries} Buchung(en) wurden erstellt, ${result.linkedEntries} vorhandene Belegbuchung(en) verbunden und ` +
        `${result.transferEntries} interne Umbuchung(en) erkannt. ${result.reviewCount} Zahlung(en) warten nur noch auf den passenden Beleg.` +
        (result.feeEntries ? ` ${result.feeEntries} Gebühr(en) wurden auf 4970 gebucht.` : ""),
    );
  }

  const bank = state.importedTransactions.filter((item) => item.accountType === "bank");
  const bankCount = bank.length;
  const bankBooked = bank.filter((item) => item.bookkeepingStatus === "booked" || item.bookkeepingStatus === "reviewed").length;
  const bankOpen = bank.filter((item) => item.bookkeepingStatus !== "reviewed" && item.status !== "ignored").length;
  const provider = state.importedTransactions.filter((item) => item.accountType === "paypal");
  const providerCount = provider.length;
  const providerInternal = provider.filter(isInternalTransfer).length;
  const providerMatched = provider.filter((item) => item.status === "matched").length;
  const providerBooked = provider.filter((item) => item.bookkeepingStatus === "booked" || item.bookkeepingStatus === "reviewed").length;
  const providerReviewed = provider.filter((item) => item.bookkeepingStatus === "reviewed").length;
  const providerFees = provider.reduce((sum, item) => sum + (item.feeAmount || 0), 0);
  const sortedTransactions = useMemo(() => [...state.importedTransactions].sort((left, right) => `${right.date}|${right.time || ""}`.localeCompare(`${left.date}|${left.time || ""}`)), [state.importedTransactions]);

  return <div>
    <PageHeader title="Bank & Zahlungsabgleich" subtitle="Bekannte Geschäftsvorgänge werden automatisch kontiert. Offen bleiben nur fehlende Belege oder Vorgänge ohne hinterlegte Regel." actions={<div className="document-actions"><Button onClick={() => onNavigate("scan")}>Datenimport öffnen</Button><Button variant="secondary" onClick={reconcile}>Regeln erneut anwenden</Button><Button variant="secondary" onClick={prepareBookkeeping}>PayPal buchen</Button></div>} />
    {message ? <div className="alert alert-success">{message}</div> : null}
    {error ? <div className="alert alert-danger">{error}</div> : null}
    {malformedLegacyImports.length ? <div className="alert alert-danger"><strong>Fehlerhafter früherer PDF-Import erkannt.</strong> {malformedLegacyImports.length} ungebuchte Zeile(n) enthalten die IBAN als Betrag und das Importdatum als Buchungsdatum. <Button variant="danger" onClick={removeMalformedLegacyImports}>Fehlerhafte Altimporte entfernen</Button></div> : null}
    <div className="stat-grid"><StatCard label="Bankbewegungen" value={String(bankCount)} detail={`${bankBooked} kontiert · ${bankOpen} offen`} /><StatCard label="Zahlungsdienstleister" value={String(providerCount)} tone="blue" detail={`${providerInternal} interne Umbuchungen`} /><StatCard label="Automatisch gebucht" value={String(providerBooked)} tone="positive" detail={`${providerReviewed} vollständig`} /><StatCard label="Gebühren" value={formatCurrency(providerFees)} tone="negative" detail={`${providerMatched} zugeordnet`} /></div>
    <Card>
      <div className="card-heading"><div><h2>Kontobewegungen</h2><p>Kasse, Bank, Flatpay, PayPal, UniTel, Prifoto und Geldtransfer werden getrennt geführt, damit keine Einnahme oder Ausgabe doppelt entsteht.</p></div></div>
      {sortedTransactions.length === 0 ? <EmptyState icon="accounts" title="Noch keine Kontobewegungen" text="Kontoauszüge und Zahlungsdienstleister-Dateien werden im zentralen Datenimport hochgeladen." /> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Datum</th><th>Konto</th><th>Art</th><th>Gegenpartei / Beschreibung</th><th>Beleg / Buchungsnummer</th><th>Abgleich</th><th>Buchhaltung</th><th>Gebühr</th><th className="align-right">Betrag</th></tr></thead><tbody>{sortedTransactions.map((item) => <TransactionRow key={item.id} item={item} document={state.documents.find((document) => document.id === item.matchedDocumentId)} ledgerEntry={state.ledger.find((entry) => entry.id === item.matchedLedgerEntryId)} onReview={() => setSelectedId(item.id)} />)}</tbody></table></div>}
    </Card>
    <div className="alert alert-info">Vorsteuer wird aus einem Kontoauszug nicht geschätzt. Der Geschäftsfall wird bereits auf das richtige Konto gebucht; bei „Beleg fehlt“ wird nach dem Hochladen der Rechnung nur noch der Steueranteil ergänzt.</div>
    <PayPalTransactionReviewModal transaction={selectedTransaction?.accountType === "paypal" ? selectedTransaction : undefined} onClose={() => setSelectedId(undefined)} onSaved={setMessage} />
    <BankTransactionReviewModal transaction={selectedTransaction?.accountType === "bank" ? selectedTransaction : undefined} onClose={() => setSelectedId(undefined)} onSaved={setMessage} />
  </div>;
}

function TransactionRow({ item, document, ledgerEntry, onReview }: { item: ImportedTransaction; document?: BusinessDocument; ledgerEntry?: LedgerEntry; onReview: () => void }) {
  const providerInternal = item.accountType === "paypal" && isInternalTransfer(item);
  const bankInternal = isBankInternalTransaction(item);
  const internal = providerInternal || bankInternal;
  const unresolved = !internal && (!ledgerEntry?.accountCode || ledgerEntry.accountCode === "0000");
  const missingDocument = !internal && !unresolved && item.bookkeepingStatus === "booked";
  const canReview = Boolean(item.matchedLedgerEntryId) && !internal && item.bookkeepingStatus !== "reviewed";
  const bookkeepingLabel = internal ? "Umbuchung" : unresolved ? "Regel erforderlich" : missingDocument ? "Gebucht · Beleg fehlt" : item.bookkeepingStatus === "reviewed" ? "Automatisch gebucht" : "Noch nicht gebucht";
  const buttonLabel = unresolved ? "Regel festlegen" : "Beleg / Konto";
  const displayReference = document?.documentNumber || item.invoiceNumber || ledgerEntry?.documentNumber || "–";
  return <tr><td>{formatDate(item.date)}<small>{item.time || ""}</small></td><td><Badge tone={item.accountType === "paypal" ? "info" : "neutral"}>{item.accountType === "paypal" ? "Dienstleister" : "Bank"}</Badge></td><td><Badge tone={internal ? "info" : item.transactionType === "refund" ? "warning" : "neutral"}>{item.accountType === "bank" ? bankTransactionKindLabel(item) : transactionTypeLabel(item.transactionType)}</Badge></td><td><strong>{item.counterparty || item.description}</strong><small>{ledgerEntry?.category || (item.counterparty ? item.description.split(" · ")[0] : item.externalId || "Keine externe Referenz")}</small></td><td><strong>{displayReference}</strong><small>{document ? `${documentTypeLabel(document)} · ${item.matchConfidence}%` : ledgerEntry?.documentNumber || item.relatedExternalId || item.externalId || ""}</small></td><td><Badge tone={internal || item.status === "matched" ? "success" : unresolved || missingDocument ? "warning" : "neutral"}>{statusLabel(internal, unresolved, missingDocument)}</Badge></td><td><div className="document-actions"><Badge tone={internal || item.bookkeepingStatus === "reviewed" ? "success" : unresolved || missingDocument ? "warning" : "neutral"}>{bookkeepingLabel}</Badge>{canReview ? <Button variant="secondary" onClick={onReview}>{buttonLabel}</Button> : null}</div></td><td>{item.feeAmount ? formatCurrency(item.feeAmount) : "–"}</td><td className={`align-right ${item.amount >= 0 ? "money-positive" : "money-negative"}`}><strong>{item.amount >= 0 ? "+" : "−"}{formatCurrency(Math.abs(item.amount))}</strong><small>{item.currency || "EUR"}</small></td></tr>;
}

function transactionTypeLabel(type?: ImportedTransactionType) { return ({ payment: "Zahlung", refund: "Rückzahlung", bankFunding: "Bank → Dienstleister", bankWithdrawal: "Dienstleister → Bank", fee: "Gebühr", other: "Umsatz" } as const)[type || "other"]; }
function statusLabel(internal: boolean, unresolved: boolean, missingDocument: boolean) { if (internal) return "Umbuchung"; if (unresolved) return "Regel erforderlich"; if (missingDocument) return "Beleg fehlt"; return "Abgeglichen"; }
function documentTypeLabel(document: BusinessDocument) { return document.type === "invoice" ? "Rechnung" : document.type === "receipt" ? "Quittung" : document.type === "estimate" ? "Kostenvoranschlag" : document.type === "purchaseContract" ? "Ankaufvertrag" : document.type === "zReport" ? "Tagesabschluss" : "Eingangsrechnung"; }
