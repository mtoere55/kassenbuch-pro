"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { formatCurrency, formatDate } from "@/lib/accounting";
import { readPdfWithLayout } from "@/lib/pdf-reader";
import {
  importPayPalMonthlyStatement,
  parsePayPalMonthlyStatement,
  type PayPalMonthlyStatement,
  type PayPalPdfImportResult,
} from "@/lib/paypal-pdf-import";
import { useKassenStore } from "@/lib/store";
import { Badge, Button, Field, Input, Modal, StatCard } from "../ui";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_INLINE_BYTES = 3 * 1024 * 1024;

export function PayPalPdfImportModal({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (message: string) => void;
}) {
  const { state, replaceState } = useKassenStore();
  const [file, setFile] = useState<File>();
  const [fileDataUrl, setFileDataUrl] = useState<string>();
  const [report, setReport] = useState<PayPalMonthlyStatement>();
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");

  const planned = useMemo<{ plan?: PayPalPdfImportResult; error?: string }>(() => {
    if (!file || !report) return {};
    try {
      return { plan: importPayPalMonthlyStatement(state, report, file.name, fileDataUrl) };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : "Der PayPal-Importplan konnte nicht erstellt werden." };
    }
  }, [file, fileDataUrl, report, state]);
  const plan = planned.plan;
  const visibleError = error || planned.error || "";

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;
    setReading(true);
    setError("");
    setFile(undefined);
    setFileDataUrl(undefined);
    setReport(undefined);
    try {
      if (selected.size > MAX_FILE_BYTES) throw new Error("Die PayPal-Datei ist größer als 20 MB.");
      if (!await isPdfFile(selected)) throw new Error("Bitte den PayPal-Monatskontoauszug als PDF auswählen.");
      const pdf = await readPdfWithLayout(selected);
      const parsed = parsePayPalMonthlyStatement(pdf.text);
      setFile(selected);
      setReport(parsed);
      setFileDataUrl(selected.size <= MAX_INLINE_BYTES ? await fileToDataUrl(selected) : undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Der PayPal-Kontoauszug konnte nicht gelesen werden.");
    } finally {
      setReading(false);
    }
  }

  function save() {
    if (!plan || !report) return;
    replaceState(plan.state);
    onImported([
      `${plan.importedTransactions} PayPal-Transaktion(en) aus ${formatDate(report.periodStart)} – ${formatDate(report.periodEnd)} wurden übernommen.`,
      `${plan.createdEntries} neue Buchung(en), ${plan.linkedEntries} bestehende Buchung(en) verbunden und ${plan.transferEntries} Bank/PayPal-Umbuchung(en) erkannt.`,
      plan.reviewCount ? `${plan.reviewCount} Lieferantenzahlung(en) sind ohne Vorsteuer gebucht und warten auf den passenden Beleg.` : "",
      plan.feeEntries ? `${plan.feeEntries} PayPal-Gebühr(en) wurden auf 4970 gebucht.` : "",
    ].filter(Boolean).join(" "));
    reset();
    onClose();
  }

  function reset() {
    setFile(undefined);
    setFileDataUrl(undefined);
    setReport(undefined);
    setReading(false);
    setError("");
  }

  function close() {
    reset();
    onClose();
  }

  const payments = report?.transactions.filter((item) => item.transactionType === "payment") || [];
  const funding = report?.transactions.filter((item) => item.transactionType === "bankFunding") || [];

  return <Modal
    open={open}
    onClose={close}
    title="PayPal-Monatskontoauszug importieren"
    wide
    footer={<><Button variant="secondary" onClick={close}>Abbrechen</Button><Button disabled={!plan || reading} onClick={save}>{plan ? `${plan.importedTransactions} Transaktionen übernehmen` : "Importieren"}</Button></>}
  >
    <div className="form-stack">
      <div className="alert alert-info"><strong>PayPal-Verrechnung:</strong> Lieferantenzahlungen werden gegen 1370 PayPal gebucht. „Bankgutschrift auf PayPal-Konto“ ist nur 1200 Bank → 1370 PayPal und kein neuer Aufwand. Wenn dieselbe Bankumbuchung bereits aus dem Sparkasse-Kontoauszug vorhanden ist, wird sie verbunden statt doppelt angelegt.</div>
      <Field label="PayPal Monatskontoauszug PDF" hint={file?.name || "PDF mit Transaktionsübersicht auswählen"}><Input type="file" accept="application/pdf,.pdf" onChange={(event) => void selectFile(event)} /></Field>
      {reading ? <div className="alert alert-info">PayPal-Saldo, Einzeltransaktionen und Transaktionscodes werden geprüft …</div> : null}
      {visibleError ? <div className="alert alert-danger">{visibleError}</div> : null}

      {report && plan ? <>
        <div className="stat-grid">
          <StatCard label="Gesendete Zahlungen" value={formatCurrency(Math.abs(report.sentPayments))} tone="negative" detail={`${payments.length} Lieferantenzahlungen`} />
          <StatCard label="Bank → PayPal" value={formatCurrency(report.credits)} tone="blue" detail={`${funding.length} Gutschriften`} />
          <StatCard label="PayPal-Gebühren" value={formatCurrency(Math.abs(report.fees))} detail="4970 · ohne Vorsteuer" />
          <StatCard label="Endbestand" value={formatCurrency(report.closingBalance)} tone="positive" detail={`${formatDate(report.periodStart)} – ${formatDate(report.periodEnd)}`} />
        </div>
        <div className="calculation-box">
          <h3>Kontrollrechnung</h3>
          <div><span>Händlerkonto</span><strong>{report.merchantId}</strong></div>
          <div><span>PayPal-ID</span><strong>{report.paypalId}</strong></div>
          <div><span>Anfangsbestand</span><strong>{formatCurrency(report.openingBalance)}</strong></div>
          <div><span>Einzeltransaktionen</span><strong>{report.transactions.length}</strong></div>
          <div><span>Neu importieren</span><strong>{plan.importedTransactions}</strong></div>
          <div><span>Bestehende Bankumbuchungen verbunden</span><strong>{plan.linkedEntries}</strong></div>
          <div><span>Endbestand</span><strong>{formatCurrency(report.closingBalance)}</strong></div>
        </div>
        <div className="alert alert-success">Anfangsbestand + Netto-Bewegungen = Endbestand wurde geprüft. Lieferantenzahlungen erhalten zunächst keine Vorsteuer aus dem PayPal-Auszug; die Umsatzsteuer wird erst mit der zugehörigen Rechnung ergänzt.</div>
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Datum</th><th>Art</th><th>Gegenpartei</th><th>Transaktionscode</th><th className="align-right">Betrag</th><th>Status</th></tr></thead><tbody>{report.transactions.map((item) => <tr key={item.externalId || item.id}><td>{formatDate(item.date)}</td><td>{item.transactionType === "bankFunding" ? "Bank → PayPal" : item.transactionType === "bankWithdrawal" ? "PayPal → Bank" : item.transactionType === "refund" ? "Rückzahlung" : "Zahlung"}</td><td>{item.counterparty || "Bank"}</td><td>{item.externalId || "–"}</td><td className={`align-right ${item.amount >= 0 ? "money-positive" : "money-negative"}`}><strong>{item.amount >= 0 ? "+" : "−"}{formatCurrency(Math.abs(item.amount))}</strong></td><td>{item.transactionType === "bankFunding" || item.transactionType === "bankWithdrawal" ? <Badge tone="info">Umbuchung</Badge> : <Badge tone="warning">Beleg prüfen</Badge>}</td></tr>)}</tbody></table></div>
      </> : null}
    </div>
  </Modal>;
}

async function isPdfFile(file: File): Promise<boolean> {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return true;
  const header = new TextDecoder("ascii").decode(await file.slice(0, 5).arrayBuffer());
  return header === "%PDF-";
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
