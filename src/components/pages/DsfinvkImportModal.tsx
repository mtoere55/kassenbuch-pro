"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { formatCurrency, formatDate } from "@/lib/accounting";
import {
  createDsfinvkImportPlan,
  parseDsfinvkExport,
  suggestDsfinvkCutoverDate,
  type DsfinvkExport,
} from "@/lib/dsfinvk-import";
import { useKassenStore } from "@/lib/store";
import { readZipTextFiles } from "@/lib/zip-reader";
import { Badge, Button, Field, Input, Modal } from "../ui";

export function DsfinvkImportModal({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (message: string) => void;
}) {
  const { state, replaceState } = useKassenStore();
  const [report, setReport] = useState<DsfinvkExport>();
  const [fileName, setFileName] = useState("");
  const [fileDataUrl, setFileDataUrl] = useState<string>();
  const [cutoverDate, setCutoverDate] = useState("");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const plan = useMemo(
    () => report && cutoverDate ? createDsfinvkImportPlan(state, report, fileName, cutoverDate, fileDataUrl) : undefined,
    [cutoverDate, fileDataUrl, fileName, report, state],
  );

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setReading(true);
    setError("");
    setReport(undefined);
    setFileName(file.name);
    setFileDataUrl(undefined);
    try {
      if (!file.name.toLowerCase().endsWith(".zip")) throw new Error("Bitte den Flatpay-DSFinV-K-Export als ZIP auswählen.");
      const files = await readZipTextFiles(await file.arrayBuffer());
      const parsed = parseDsfinvkExport(files);
      setReport(parsed);
      setCutoverDate(suggestDsfinvkCutoverDate(state, parsed));
      setFileDataUrl(await toDataUrl(file));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Der Flatpay-Export konnte nicht gelesen werden.");
    } finally {
      setReading(false);
      event.target.value = "";
    }
  }

  function importReport() {
    if (!plan || !report) return;
    if (!plan.documents.length && !plan.entries.length) {
      setError("Alle Kassenabschlüsse und Buchungen aus diesem Export sind bereits vorhanden.");
      return;
    }
    replaceState({
      ...state,
      documents: [...plan.documents, ...state.documents],
      ledger: [...plan.entries, ...state.ledger],
    });
    onImported([
      `${report.closings.length} Flatpay-Tagesabschlüsse wurden rechnerisch geprüft.`,
      `${plan.bookedClosings} Abschluss/Abschlüsse ab ${formatDate(plan.cutoverDate)} wurden mit ${plan.entries.length} Sammelbuchung(en) übernommen.`,
      plan.archiveOnlyClosings ? `${plan.archiveOnlyClosings} ältere Abschlüsse wurden wegen der MeinBuch-Überschneidung nur archiviert.` : "",
      plan.duplicateClosings ? `${plan.duplicateClosings} bereits vorhandene Abschlüsse wurden erkannt.` : "",
    ].filter(Boolean).join(" "));
    reset();
    onClose();
  }

  function reset() {
    setReport(undefined);
    setFileName("");
    setFileDataUrl(undefined);
    setCutoverDate("");
    setError("");
  }

  function close() { reset(); onClose(); }
  const sample = report?.closings.slice(-12) || [];

  return <Modal
    open={open}
    onClose={close}
    title="Flatpay-DSFinV-K gesammelt importieren"
    wide
    footer={<><Button variant="secondary" onClick={close}>Abbrechen</Button><Button disabled={!plan || reading || (!plan.documents.length && !plan.entries.length)} onClick={importReport}>{plan ? `${plan.bookedClosings} Tage buchen` : "Importieren"}</Button></>}
  >
    <div className="form-stack">
      <div className="alert alert-info"><strong>Kein täglicher Einzelimport:</strong> Ein DSFinV-K-ZIP kann viele Tagesabschlüsse enthalten. Jeder Z-Abschluss wird einzeln geprüft, nummeriert und bei erneutem Upload automatisch übersprungen.</div>
      <Field label="Flatpay DSFinV-K / GDPdU ZIP" hint={fileName || "Zeitraumsexport oder gesammelten Kassenexport auswählen"}><Input type="file" accept=".zip,application/zip" onChange={(event) => void selectFile(event)} /></Field>
      {reading ? <div className="alert alert-info">ZIP, Tagesabschlüsse, Zahlarten, Belege, KDV und TSE-Zuordnungen werden lokal geprüft …</div> : null}
      {error ? <div className="alert alert-danger">{error}</div> : null}
      {report && plan ? <>
        <div className="calculation-box">
          <h3>Periodenprüfung</h3>
          <div><span>Zeitraum</span><strong>{formatDate(report.startDate)} – {formatDate(report.endDate)}</strong></div>
          <div><span>Tagesabschlüsse</span><strong>{report.closings.length}</strong></div>
          <div><span>Einzelbelege</span><strong>{report.receiptCount}</strong></div>
          <div><span>Gesamtumsatz</span><strong>{formatCurrency(report.totalPayments)}</strong></div>
          <div><span>Bar</span><strong>{formatCurrency(report.totalCash)}</strong></div>
          <div><span>Karte / Flatpay</span><strong>{formatCurrency(report.totalCard)}</strong></div>
          <div><span>Umsatzsteuer</span><strong>{formatCurrency(report.totalVat)}</strong></div>
          <div><span>Enthaltene Exportdateien</span><strong>{report.sourceFiles}</strong></div>
        </div>
        <Field label="Ab diesem Datum buchhalterisch übernehmen" hint="Ältere Z-Abschlüsse werden nur archiviert. Das verhindert Doppelbuchungen mit der alten MeinBuch-.kas-Datei."><Input type="date" value={cutoverDate} min={report.startDate} max={addDays(report.endDate, 1)} onChange={(event) => setCutoverDate(event.target.value)} /></Field>
        <div className="badge-row"><Badge tone="success">{plan.bookedClosings} Tage buchen</Badge><Badge tone="info">{plan.archiveOnlyClosings} Tage nur archivieren</Badge>{plan.duplicateClosings ? <Badge tone="warning">{plan.duplicateClosings} vorhanden</Badge> : null}</div>
        <div className="alert alert-info">Barumsätze erhöhen Konto 1000 Kasse. Kartenzahlungen gehen auf 1360 Flatpay/Geldtransit. 19 %, 7 %, steuerfreie Umsätze und nicht steuerbare Aufschläge werden getrennt gebucht.</div>
        <div className="card-heading"><div><h3>Letzte Tagesabschlüsse im ZIP</h3><p>Die vollständige Datei wird verarbeitet; hier werden die letzten {sample.length} Tage gezeigt.</p></div></div>
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Datum</th><th>Z-Nr.</th><th>Belege</th><th className="align-right">Bar</th><th className="align-right">Karte</th><th className="align-right">USt.</th><th>Status</th></tr></thead><tbody>{sample.map((closing) => <tr key={closing.fingerprint}><td>{formatDate(closing.date)}</td><td>Z {closing.zNumber}</td><td>{closing.receiptCount}</td><td className="align-right">{formatCurrency(closing.cashPayments)}</td><td className="align-right">{formatCurrency(closing.cardPayments)}</td><td className="align-right">{formatCurrency(closing.vat19 + closing.vat7)}</td><td>{closing.date >= cutoverDate ? <Badge tone="success">Buchen</Badge> : <Badge>Archiv</Badge>}</td></tr>)}</tbody></table></div>
      </> : null}
    </div>
  </Modal>;
}

function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
