"use client";

import { useMemo, useRef, useState } from "react";
import { formatCurrency, formatDate } from "@/lib/accounting";
import {
  bankTransactionKindLabel,
  importBankStatement,
  isBankInternalTransaction,
  parseSparkasseStatement,
} from "@/lib/bank-statement";
import { parseTransactionsCsv, summarizeImportedTransactions } from "@/lib/csv";
import {
  isInternalTransfer,
  payPalBookkeepingStatusLabel,
  preparePayPalBookkeeping,
} from "@/lib/paypal-bookkeeping";
import { readPdfWithLayout } from "@/lib/pdf-reader";
import { useKassenStore } from "@/lib/store";
import { reconcileImportedState } from "@/lib/transaction-reconciliation";
import type { BusinessDocument, ImportedTransaction, ImportedTransactionType } from "@/lib/types";
import { Icon } from "../Icon";
import { Badge, Button, Card, EmptyState, PageHeader, StatCard } from "../ui";
import { BankTransactionReviewModal } from "./BankTransactionReviewModal";
import { FlatpayReportImportModal } from "./FlatpayReportImportModal";
import { PayPalTransactionReviewModal } from "./PayPalTransactionReviewModal";

const MAX_INLINE_PDF_BYTES = 3 * 1024 * 1024;

export function AccountsPage() {
  const { state, importTransactions, replaceState } = useKassenStore();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [flatpayOpen, setFlatpayOpen] = useState(false);
  const [bankPdfLoading, setBankPdfLoading] = useState(false);
  const bankCsvInput = useRef<HTMLInputElement>(null);
  const bankPdfInput = useRef<HTMLInputElement>(null);
  const paypalInput = useRef<HTMLInputElement>(null);
  const selectedTransaction = state.importedTransactions.find((item) => item.id === selectedId);

  async function handleCsv(file: File | undefined, type: "bank" | "paypal") {
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
            `${summary.internalTransfers} interne Bankbewegungen. Danach „PayPal-Buchhaltung erstellen“ ausführen.`,
        );
      } else {
        setMessage(`${added} neue Bank-Umsätze importiert. CSV-Zeilen werden erst nach Abgleich gebucht.`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Die CSV-Datei konnte nicht importiert werden.");
    }
  }

  async function handleBankPdf(file: File | undefined) {
    if (!file) return;
    setError("");
    setMessage("Bank-PDF wird gelesen, rechnerisch geprüft und direkt gebucht …");
    setBankPdfLoading(true);
    try {
      if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
        throw new Error("Bitte einen Sparkasse-Kontoauszug als PDF auswählen.");
      }
      const layout = await readPdfWithLayout(file);
      const report = parseSparkasseStatement(layout.text);
      const dataUrl = file.size <= MAX_INLINE_PDF_BYTES ? await fileToDataUrl(file) : undefined;
      const result = importBankStatement(state, report, file.name, dataUrl);
      replaceState(result.state);
      setMessage(
        `Kontoauszug ${report.statementNumber} wurde geprüft und sofort übernommen: ` +
          `${result.imported} Bankbewegungen, ${result.createdEntries} neue Buchungen, ` +
          `${result.matchedEntries} vorhandene Buchungen zugeordnet und ${result.internalTransfers} Umbuchungen erkannt. ` +
          `${result.reviewCount} Buchungen benötigen noch Rechnung/Konto-Prüfung.` +
          (result.skipped ? ` ${result.skipped} bereits vorhandene Bewegungen wurden übersprungen.` : ""),
      );
    } catch (cause) {
      setMessage("");
      setError(cause instanceof Error ? cause.message : "Der Bank-Kontoauszug konnte nicht importiert werden.");
    } finally {
      setBankPdfLoading(false);
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

  function prepareBookkeeping() {
    const paypalCount = state.importedTransactions.filter((item) => item.accountType === "paypal").length;
    if (!paypalCount) {
      setError("Bitte zuerst einen PayPal-Aktivitätsbericht als CSV importieren.");
      return;
    }
    const result = preparePayPalBookkeeping(state);
    replaceState(result.state);
    setError("");
    setMessage(
      `${result.createdEntries} Buchung(en) wurden erstellt, ${result.linkedEntries} vorhandene Belegbuchung(en) verbunden und ` +
        `${result.transferEntries} interne Umbuchung(en) erkannt. ${result.reviewCount} Zahlung(en) müssen noch anhand der Rechnung geprüft werden.` +
        (result.feeEntries ? ` ${result.feeEntries} PayPal-Gebühr(en) wurden auf 4970 gebucht.` : ""),
    );
  }

  const bank = state.importedTransactions.filter((item) => item.accountType === "bank");
  const bankCount = bank.length;
  const bankBooked = bank.filter((item) => item.bookkeepingStatus === "booked" || item.bookkeepingStatus === "reviewed").length;
  const bankReview = bank.filter((item) => item.bookkeepingStatus === "booked").length;
  const bankStatements = state.documents.filter(
    (document) => document.type === "zReport" && document.metadata?.reportKind === "Kontoauszug",
  );
  const paypal = state.importedTransactions.filter((item) => item.accountType === "paypal");
  const paypalCount = paypal.length;
  const paypalInternal = paypal.filter(isInternalTransfer).length;
  const paypalMatched = paypal.filter((item) => item.status === "matched").length;
  const paypalReview = paypal.filter(
    (item) => item.bookkeepingStatus === "booked" || item.status === "needsReview" || item.status === "new",
  ).length;
  const paypalBooked = paypal.filter(
    (item) => item.bookkeepingStatus === "booked" || item.bookkeepingStatus === "reviewed",
  ).length;
  const paypalReviewed = paypal.filter((item) => item.bookkeepingStatus === "reviewed").length;
  const paypalFees = paypal.reduce((sum, item) => sum + (item.feeAmount || 0), 0);
  const flatpayReports = state.documents.filter(
    (document) => document.type === "zReport" && document.metadata?.provider === "Flatpay",
  );
  const sortedTransactions = useMemo(
    () =>
      [...state.importedTransactions].sort((left, right) =>
        `${right.date}|${right.time || ""}`.localeCompare(`${left.date}|${left.time || ""}`),
      ),
    [state.importedTransactions],
  );

  return <div>
    <PageHeader
      title="Bank, PayPal & Flatpay"
      subtitle="PDF- und CSV-Kontobewegungen importieren, automatisch buchen und mit Belegen abgleichen."
      actions={<div className="document-actions"><Button variant="secondary" onClick={reconcile}>Automatisch abgleichen</Button><Button onClick={prepareBookkeeping}>PayPal-Buchhaltung erstellen</Button></div>}
    />
    {message ? <div className="alert alert-success">{message}</div> : null}
    {error ? <div className="alert alert-danger">{error}</div> : null}
    <div className="account-cards">
      <Card className="account-card">
        <div className="account-logo bank"><Icon name="accounts" width={25} height={25} /></div>
        <div>
          <h2>Geschäftskonto</h2>
          <p>Sparkasse-PDF wird geprüft und danach ohne weiteren Schritt direkt in die Buchhaltung übernommen.</p>
          <div className="account-meta"><Badge tone="info">{bankCount} Bewegungen</Badge><Badge tone="success">{bankBooked} gebucht</Badge><Badge tone="warning">{bankReview} prüfen</Badge><Badge tone="info">{bankStatements.length} Auszüge</Badge></div>
        </div>
        <div className="document-actions">
          <Button disabled={bankPdfLoading} icon="upload" onClick={() => bankPdfInput.current?.click()}>{bankPdfLoading ? "PDF wird gebucht …" : "Bank-PDF importieren"}</Button>
          <Button variant="secondary" onClick={() => bankCsvInput.current?.click()}>Bank-CSV</Button>
        </div>
        <input ref={bankPdfInput} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => { void handleBankPdf(event.target.files?.[0]); event.target.value = ""; }} />
        <input ref={bankCsvInput} type="file" accept=".csv,text/csv" hidden onChange={(event) => { void handleCsv(event.target.files?.[0], "bank"); event.target.value = ""; }} />
      </Card>
      <Card className="account-card">
        <div className="account-logo paypal">P</div>
        <div>
          <h2>PayPal Business</h2>
          <p>Brutto, Gebühr, Netto, Rechnung und verbundene Bankbewegungen werden getrennt verarbeitet.</p>
          <div className="account-meta"><Badge tone="info">{paypalCount} Zeilen</Badge><Badge tone="success">{paypalBooked} gebucht</Badge><Badge tone="warning">{paypalReview} prüfen</Badge></div>
        </div>
        <Button variant="secondary" icon="upload" onClick={() => paypalInput.current?.click()}>PayPal-CSV importieren</Button>
        <input ref={paypalInput} type="file" accept=".csv,text/csv" hidden onChange={(event) => { void handleCsv(event.target.files?.[0], "paypal"); event.target.value = ""; }} />
      </Card>
      <Card className="account-card">
        <div className="account-logo bank">F</div>
        <div>
          <h2>Flatpay Umsatzbericht</h2>
          <p>PDF automatisch auslesen, Summen prüfen, vorhandene Buchungen abgleichen und nur fehlende Umsätze ergänzen.</p>
          <div className="account-meta"><Badge tone="info">{flatpayReports.length} Berichte</Badge><Badge tone="success">PDF-Abgleich</Badge></div>
        </div>
        <Button variant="secondary" icon="upload" onClick={() => setFlatpayOpen(true)}>Flatpay-PDF importieren</Button>
      </Card>
    </div>
    {paypalCount ? <div className="stat-grid">
      <StatCard label="PayPal-Zeilen" value={String(paypalCount)} detail={`${paypalInternal} interne Umbuchungen`} />
      <StatCard label="Buchhaltung" value={String(paypalBooked)} tone="positive" detail={`${paypalReviewed} geprüft`} />
      <StatCard label="Noch prüfen" value={String(paypalReview)} tone="negative" detail={`${paypalMatched} mit Beleg zugeordnet`} />
      <StatCard label="PayPal-Gebühren" value={formatCurrency(paypalFees)} tone="blue" detail="Entgelt aus CSV" />
    </div> : null}
    <Card>
      <div className="card-heading"><div><h2>Kontobewegungen</h2><p>Flatpay-Auszahlungen, Bargeldeinzahlungen und PayPal-Bankbelastungen werden als Umbuchungen behandelt, nicht als doppelte Einnahmen oder Ausgaben.</p></div></div>
      {sortedTransactions.length === 0 ? (
        <EmptyState icon="accounts" title="Noch keine Kontobewegungen" text="Lade einen Sparkasse-Kontoauszug als PDF oder einen PayPal-Bericht als CSV hoch." />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Datum</th><th>Konto</th><th>Art</th><th>Gegenpartei / Beschreibung</th><th>Rechnung / Treffer</th><th>Abgleich</th><th>Buchhaltung</th><th>Gebühr</th><th className="align-right">Betrag</th></tr></thead>
            <tbody>{sortedTransactions.map((item) => (
              <TransactionRow
                key={item.id}
                item={item}
                document={state.documents.find((document) => document.id === item.matchedDocumentId)}
                onReview={() => setSelectedId(item.id)}
              />
            ))}</tbody>
          </table>
        </div>
      )}
    </Card>
    <div className="alert alert-info">Bank-PDF-Buchungen werden sofort angelegt. Der Kontoauszug liefert jedoch keine sichere Vorsteuer: Bei Lieferantenzahlungen bleibt MwSt. zunächst 0 %, bis die Rechnung über „Prüfen“ kontrolliert wurde.</div>
    <PayPalTransactionReviewModal transaction={selectedTransaction?.accountType === "paypal" ? selectedTransaction : undefined} onClose={() => setSelectedId(undefined)} onSaved={setMessage} />
    <BankTransactionReviewModal transaction={selectedTransaction?.accountType === "bank" ? selectedTransaction : undefined} onClose={() => setSelectedId(undefined)} onSaved={setMessage} />
    <FlatpayReportImportModal open={flatpayOpen} onClose={() => setFlatpayOpen(false)} onImported={setMessage} />
  </div>;
}

function TransactionRow({
  item,
  document,
  onReview,
}: {
  item: ImportedTransaction;
  document?: BusinessDocument;
  onReview: () => void;
}) {
  const paypalInternal = item.accountType === "paypal" && isInternalTransfer(item);
  const bankInternal = isBankInternalTransaction(item);
  const internal = paypalInternal || bankInternal;
  const canReview = Boolean(item.matchedLedgerEntryId) && !internal && item.bookkeepingStatus !== "reviewed";
  const bookkeepingLabel = item.bookkeepingStatus === "reviewed"
    ? "Geprüft"
    : item.bookkeepingStatus === "booked"
      ? "Gebucht · prüfen"
      : internal
        ? "Umbuchung"
        : "Noch nicht gebucht";
  return <tr>
    <td>{formatDate(item.date)}<small>{item.time || ""}</small></td>
    <td><Badge tone={item.accountType === "paypal" ? "info" : "neutral"}>{item.accountType === "paypal" ? "PayPal" : "Bank"}</Badge></td>
    <td><Badge tone={internal ? "info" : item.transactionType === "refund" ? "warning" : "neutral"}>{item.accountType === "bank" ? bankTransactionKindLabel(item) : transactionTypeLabel(item.transactionType)}</Badge></td>
    <td><strong>{item.counterparty || item.description}</strong><small>{item.counterparty ? item.description.split(" · ")[0] : item.externalId || "Keine externe Referenz"}</small></td>
    <td><strong>{document?.documentNumber || item.invoiceNumber || "–"}</strong><small>{document ? `${documentTypeLabel(document)} · ${item.matchConfidence}%` : item.relatedExternalId || item.externalId || ""}</small></td>
    <td><Badge tone={item.status === "matched" ? "success" : item.status === "needsReview" ? "warning" : item.status === "ignored" ? "info" : "neutral"}>{statusLabel(item, internal)}</Badge></td>
    <td><div className="document-actions"><Badge tone={item.bookkeepingStatus === "reviewed" ? "success" : item.bookkeepingStatus === "booked" ? "warning" : internal ? "info" : "neutral"}>{bookkeepingLabel}</Badge>{canReview ? <Button variant="secondary" onClick={onReview}>Prüfen</Button> : null}</div></td>
    <td>{item.feeAmount ? formatCurrency(item.feeAmount) : "–"}</td>
    <td className={`align-right ${item.amount >= 0 ? "money-positive" : "money-negative"}`}><strong>{item.amount >= 0 ? "+" : "−"}{formatCurrency(Math.abs(item.amount))}</strong><small>{item.currency || "EUR"}</small></td>
  </tr>;
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

function statusLabel(item: ImportedTransaction, internal: boolean) {
  if (internal) return "Umbuchung";
  return item.status === "matched" ? "Zugeordnet" : item.status === "needsReview" ? "Prüfen" : item.status === "ignored" ? "Ignoriert" : "Neu";
}

function documentTypeLabel(document: BusinessDocument) {
  if (document.metadata?.reportKind === "Kontoauszug") return "Kontoauszug";
  if (document.metadata?.provider === "Flatpay") return "Umsatzbericht";
  return ({
    invoice: "Rechnung",
    receipt: "Quittung",
    purchaseContract: "Ankaufvertrag",
    supplierInvoice: "Eingangsrechnung",
    zReport: "Tagesabschluss",
  } as const)[document.type];
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
