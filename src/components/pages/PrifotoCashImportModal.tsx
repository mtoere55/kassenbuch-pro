"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { formatCurrency, formatDate } from "@/lib/accounting";
import { readPdfWithLayout } from "@/lib/pdf-reader";
import {
  createPrifotoCashImportPlan,
  parsePrifotoCashReport,
  type PrifotoCashImportPlan,
  type PrifotoCashReport,
} from "@/lib/prifoto-cash-import";
import { useKassenStore } from "@/lib/store";
import { Badge, Button, Field, Input, Modal, StatCard } from "../ui";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_INLINE_BYTES = 3 * 1024 * 1024;

export function PrifotoCashImportModal({
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
  const [report, setReport] = useState<PrifotoCashReport>();
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const planned = useMemo<{ plan?: PrifotoCashImportPlan; error?: string }>(() => {
    if (!file || !report) return {};
    try {
      return { plan: createPrifotoCashImportPlan(state, report, file.name, fileDataUrl) };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : "Der Prifoto-Importplan konnte nicht erstellt werden." };
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
      if (selected.size > MAX_FILE_BYTES) throw new Error("Die Prifoto-Datei ist größer als 20 MB.");
      if (!await isPdfFile(selected)) throw new Error("Bitte den Prifoto-Umsatzbericht als PDF auswählen.");
      const pdf = await readPdfWithLayout(selected);
      const parsed = parsePrifotoCashReport(pdf.text);
      setFile(selected);
      setReport(parsed);
      setFileDataUrl(selected.size <= MAX_INLINE_BYTES ? await fileToDataUrl(selected) : undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Der Prifoto-Bericht konnte nicht gelesen werden.");
    } finally {
      setReading(false);
    }
  }

  function save() {
    if (!report || !plan || plan.conflicts.length) return;
    replaceState({
      ...state,
      documents: [plan.document, ...state.documents],
      ledger: [...plan.entries, ...state.ledger],
    });
    onImported([
      `${report.invoiceNumber} wurde geprüft und archiviert.`,
      `${plan.importedDays} neue oder unvollständige Prifoto-Verkaufstag(e) wurden mit ${formatCurrency(plan.importedCash)} Restbetrag in Kasse 1000 ergänzt.`,
      plan.partialDays.length ? `${plan.partialDays.length} teilweise vorhandene Tagessumme(n) wurden nur um den fehlenden Betrag ergänzt.` : "",
      plan.skippedExistingDays ? `${plan.skippedExistingDays} vollständig vorhandene Tagessumme(n) wurden nicht doppelt gebucht.` : "",
      `Gesamtbericht: Prifoto-Anteil ${formatCurrency(plan.partnerShare)} auf 1592; eigener Bruttoanteil ${formatCurrency(plan.ownShare)} auf 8401 mit ${formatCurrency(plan.ownVat)} Umsatzsteuer.`,
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

  function close() { reset(); onClose(); }

  return <Modal
    open={open}
    onClose={close}
    title="Prifoto-Tagesverkäufe vollständig bar importieren"
    wide
    footer={<><Button variant="secondary" onClick={close}>Abbrechen</Button><Button disabled={!plan || reading || Boolean(plan.conflicts.length)} onClick={save}>{plan ? `${plan.importedDays} Tage ergänzen` : "Importieren"}</Button></>}
  >
    <div className="form-stack">
      <div className="alert alert-info"><strong>Fest bestätigte Geschäftsregel:</strong> Alle Prifoto-Kundenzahlungen werden bar behandelt. Jede Tagessumme erhöht Kasse 1000 genau einmal und wird 50/50 auf 1592 Prifoto-Verrechnung sowie 8401 eigenen Provisionserlös verteilt. Bereits vorhandene Teilbeträge werden nur bis zur PDF-Tagessumme ergänzt.</div>
      <Field label="Prifoto-Umsatzbericht" hint={file?.name || "PDF auswählen; Dateiendung ist nicht erforderlich"}><Input type="file" accept="application/pdf,.pdf" onChange={(event) => void selectFile(event)} /></Field>
      {reading ? <div className="alert alert-info">Tagesumsätze, Bestellungen und Gesamtsumme werden positionsgetreu aus dem PDF gelesen …</div> : null}
      {visibleError ? <div className="alert alert-danger">{visibleError}</div> : null}
      {report && plan ? <>
        <div className="stat-grid">
          <StatCard label="Bar kassiert laut PDF" value={formatCurrency(report.total)} detail={`${formatDate(report.periodStart)} – ${formatDate(report.periodEnd)}`} />
          <StatCard label="Jetzt noch buchen" value={formatCurrency(plan.importedCash)} tone="blue" detail={`${plan.importedDays} neue/ergänzte Tage`} />
          <StatCard label="Eigener Bruttoanteil gesamt" value={formatCurrency(plan.ownShare)} tone="positive" detail={`8401 · darin USt. ${formatCurrency(plan.ownVat)}`} />
          <StatCard label="Verkaufstage" value={String(report.salesDayCount)} detail={`${report.orderCount} Bestellungen`} />
        </div>
        <div className="calculation-box">
          <h3>Automatische Buchung</h3>
          <div><span>Bericht</span><strong>{report.invoiceNumber}</strong></div>
          <div><span>Rechnungsdatum</span><strong>{formatDate(report.invoiceDate)}</strong></div>
          <div><span>Neue / ergänzte Tage</span><strong>{plan.importedDays}</strong></div>
          <div><span>Davon teilweise vorhanden</span><strong>{plan.partialDays.length}</strong></div>
          <div><span>Vollständig vorhanden</span><strong>{plan.skippedExistingDays}</strong></div>
          <div><span>Erzeugte Buchungszeilen</span><strong>{plan.entries.length}</strong></div>
        </div>
        {report.productDifference !== undefined && Math.abs(report.productDifference) > 0.02 ? <div className="alert alert-warning">Die Produktgrafik des PDFs ergibt {formatCurrency(report.productTotal || 0)} und weicht um {formatCurrency(report.productDifference)} von der geprüften Tagessumme ab. Für die Buchhaltung werden ausschließlich Tageszeilen, Bestellanzahl und Gesamtumsatz verwendet.</div> : null}
        {plan.partialDays.length ? <div className="alert alert-info"><strong>Teilbeträge erkannt:</strong> Diese Tage werden nicht blockiert. Es wird ausschließlich der Unterschied zwischen vorhandener Kassenbuchung und PDF-Tagessumme ergänzt.<div className="table-wrap"><table className="data-table"><thead><tr><th>Datum</th><th className="align-right">PDF</th><th className="align-right">Vorhanden</th><th className="align-right">Noch buchen</th></tr></thead><tbody>{plan.partialDays.map((day) => <tr key={day.date}><td>{formatDate(day.date)}</td><td className="align-right">{formatCurrency(day.reportTotal)}</td><td className="align-right">{formatCurrency(day.existingTotal)}</td><td className="align-right"><strong>{formatCurrency(day.remainingTotal)}</strong></td></tr>)}</tbody></table></div></div> : null}
        {plan.conflicts.length ? <div className="alert alert-danger"><strong>Import gesperrt:</strong> {plan.conflicts.length} Tag(e) besitzen mehr Prifoto-Kassenbetrag als im PDF ausgewiesen oder eine unplausible 50/50-Verteilung.<div className="table-wrap"><table className="data-table"><thead><tr><th>Datum</th><th className="align-right">PDF</th><th className="align-right">Vorhanden</th><th className="align-right">Differenz</th></tr></thead><tbody>{plan.conflicts.map((conflict) => <tr key={conflict.date}><td>{formatDate(conflict.date)}</td><td className="align-right">{formatCurrency(conflict.reportTotal)}</td><td className="align-right">{formatCurrency(conflict.existingTotal)}</td><td className="align-right">{formatCurrency(conflict.difference)}</td></tr>)}</tbody></table></div></div> : null}
        {!plan.conflicts.length ? <div className="alert alert-success">Tagesumsätze, Bestellungen und Gesamtumsatz stimmen überein. Vollständige Tage werden übersprungen; unvollständige Tage werden nur bis zur PDF-Tagessumme ergänzt.</div> : null}
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Datum</th><th>Bestellungen</th><th className="align-right">PDF gesamt</th><th className="align-right">Vorhanden</th><th className="align-right">Noch buchen</th><th>Status</th></tr></thead><tbody>{report.days.map((day) => {
          const conflict = plan.conflicts.find((item) => item.date === day.date);
          const partial = plan.partialDays.find((item) => item.date === day.date);
          const bookedEntries = plan.entries.filter((entry) => entry.date === day.date && entry.sourceId?.startsWith("prifoto-sales:"));
          const remaining = roundMoney(bookedEntries.reduce((sum, entry) => sum + (entry.cashChange || 0), 0));
          const existing = partial?.existingTotal || (remaining > 0 ? 0 : day.amount);
          const status = conflict
            ? <Badge tone="warning">Prüfen</Badge>
            : partial
              ? <Badge tone="info">Rest {formatCurrency(partial.remainingTotal)}</Badge>
              : remaining > 0
                ? <Badge tone="success">Bar buchen</Badge>
                : <Badge>Schon vorhanden</Badge>;
          return <tr key={day.date}><td>{formatDate(day.date)}</td><td>{day.orders}</td><td className="align-right">{formatCurrency(day.amount)}</td><td className="align-right">{formatCurrency(existing)}</td><td className="align-right">{formatCurrency(remaining)}</td><td>{status}</td></tr>;
        })}</tbody></table></div>
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

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
