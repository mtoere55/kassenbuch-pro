"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { formatCurrency, formatDate } from "@/lib/accounting";
import { readPdfForOcr } from "@/lib/pdf-reader";
import { useKassenStore } from "@/lib/store";
import {
  compareUnitelReportToLedger,
  createUnitelArchivePlan,
  parseUnitelMonthlyReport,
  validateUnitelMonthlyReport,
  type UnitelMonthlyReport,
} from "@/lib/unitel-report";
import { Button, Field, Input, Modal, StatCard } from "../ui";

const MAX_INLINE_BYTES = 3 * 1024 * 1024;

export function UnitelReportImportModal({
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
  const [report, setReport] = useState<UnitelMonthlyReport>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const validation = useMemo(
    () => report ? validateUnitelMonthlyReport(report) : undefined,
    [report],
  );
  const comparison = useMemo(
    () => report ? compareUnitelReportToLedger(report, state.ledger) : undefined,
    [report, state.ledger],
  );

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;
    setError("");
    setInfo("");
    setReport(undefined);
    setLoading(true);
    try {
      const pdf = selected.type === "application/pdf" || selected.name.toLowerCase().endsWith(".pdf");
      if (!pdf) throw new Error("Bitte eine UniTel-Monatsabrechnung als PDF auswählen.");
      const result = await readPdfForOcr(selected);
      let text = result.embeddedText;
      if (!text.trim() && result.pageImages.length) {
        text = await recognizeImages(result.pageImages);
      }
      if (!text.trim()) throw new Error("Im PDF konnte kein lesbarer Text gefunden werden.");
      const parsed = parseUnitelMonthlyReport(text);
      const checked = validateUnitelMonthlyReport(parsed);
      if (!checked.valid) throw new Error(checked.issues.join(" "));
      setFile(selected);
      setReport(parsed);
      setInfo(
        result.pageImages.length
          ? `${result.processedPages} PDF-Seite(n) wurden per OCR gelesen und rechnerisch geprüft.`
          : `${result.processedPages} PDF-Seite(n) wurden direkt gelesen und rechnerisch geprüft.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Die UniTel-Abrechnung konnte nicht gelesen werden.");
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!report || !file || !validation?.valid) return;
    setError("");
    try {
      const dataUrl = file.size <= MAX_INLINE_BYTES ? await fileToDataUrl(file) : undefined;
      const plan = createUnitelArchivePlan(state, report, file.name, dataUrl);
      replaceState({
        ...state,
        documents: [plan.document, ...state.documents],
      });
      onImported(
        plan.comparison.exact
          ? `UniTel-Abrechnung ${report.invoiceNumber} wurde geprüft und archiviert. Erkannte Guthaben-Buchungen stimmen mit ${formatCurrency(report.totalCardValue)} überein; es wurde nichts zusätzlich gebucht.`
          : `UniTel-Abrechnung ${report.invoiceNumber} wurde als Kontrollbeleg archiviert. Zur Abrechnung fehlen in den erkannten Guthaben-Buchungen ${formatCurrency(plan.comparison.difference)}. Es wurde bewusst keine automatische Umsatzbuchung erstellt.`,
      );
      reset();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Die UniTel-Abrechnung konnte nicht archiviert werden.");
    }
  }

  function reset() {
    setFile(undefined);
    setReport(undefined);
    setLoading(false);
    setError("");
    setInfo("");
  }

  function close() {
    reset();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="UniTel-Monatsabrechnung prüfen"
      wide
      footer={
        <>
          <Button variant="secondary" onClick={close}>Abbrechen</Button>
          <Button disabled={!report || !validation?.valid || loading} onClick={() => void save()}>
            Kontrollbeleg archivieren
          </Button>
        </>
      }
    >
      <div className="form-stack">
        <div className="alert alert-info">
          Die Monatsabrechnung wird automatisch gelesen und rechnerisch geprüft. Sie dient nur als Kontrolle und wird nicht noch einmal als Tagesumsatz in die Kasse gebucht.
        </div>
        {error ? <div className="alert alert-danger">{error}</div> : null}
        {info ? <div className="alert alert-success">{info}</div> : null}
        <Field label="UniTel-PDF" hint={file?.name || "Monatsabrechnung als PDF auswählen"}>
          <Input type="file" accept="application/pdf,.pdf" onChange={(event) => void selectFile(event)} />
        </Field>
        {loading ? <div className="scanner-placeholder"><p>UniTel-Abrechnung wird gelesen und geprüft …</p></div> : null}

        {report && comparison ? (
          <>
            <div className="stat-grid">
              <StatCard label="Guthaben Gesamt" value={formatCurrency(report.totalCardValue)} detail={`${formatDate(report.periodStart)} – ${formatDate(report.periodEnd)}`} />
              <StatCard label="Provision Brutto" value={formatCurrency(report.commissionGross)} tone="positive" detail={`Netto ${formatCurrency(report.commissionNet)}`} />
              <StatCard label="Provision MwSt. 19 %" value={formatCurrency(report.commissionVat)} tone="negative" detail="in der Provision enthalten" />
              <StatCard label="An UniTel zu zahlen" value={formatCurrency(report.payableAmount)} tone="blue" detail={`Rechnung ${report.invoiceNumber}`} />
            </div>

            <div className={comparison.exact ? "alert alert-success" : "alert alert-warning"}>
              {comparison.exact
                ? `${comparison.recognizedEntries} erkannte UniTel-/Guthaben-Buchung(en) stimmen vollständig mit der Monatsabrechnung überein.`
                : `${comparison.recognizedEntries} passende Buchung(en) wurden gefunden. Die Abweichung beträgt ${formatCurrency(comparison.difference)}. Der Beleg wird nur archiviert und löst keine Doppelbuchung aus.`}
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Kontrolle</th><th>UniTel-PDF</th><th>Kassenbuch</th><th>Differenz</th></tr></thead>
                <tbody>
                  <CheckRow label="Guthaben-Verkäufe" report={report.totalCardValue} ledger={comparison.ledgerTotal} />
                  <tr><td><strong>Provision Brutto</strong></td><td>{formatCurrency(report.commissionGross)}</td><td colSpan={2}>Kontrollwert, keine zusätzliche Kassenbuchung</td></tr>
                  <tr><td><strong>Rechnungsbetrag</strong></td><td>{formatCurrency(report.payableAmount)}</td><td colSpan={2}>Später mit Bankzahlung abgleichen</td></tr>
                </tbody>
              </table>
            </div>

            <dl className="detail-list">
              <div><dt>Kundennummer</dt><dd>{report.customerNumber || "–"}</dd></div>
              <div><dt>Rechnungsnummer</dt><dd>{report.invoiceNumber}</dd></div>
              <div><dt>Rechnungsdatum</dt><dd>{formatDate(report.invoiceDate)}</dd></div>
              <div><dt>Netto Provision</dt><dd>{formatCurrency(report.commissionNet)}</dd></div>
              <div><dt>MwSt. auf Provision</dt><dd>{formatCurrency(report.commissionVat)}</dd></div>
              <div><dt>Brutto Provision</dt><dd>{formatCurrency(report.commissionGross)}</dd></div>
            </dl>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

function CheckRow({ label, report, ledger }: { label: string; report: number; ledger: number }) {
  const difference = roundMoney(report - ledger);
  return (
    <tr>
      <td><strong>{label}</strong></td>
      <td>{formatCurrency(report)}</td>
      <td>{formatCurrency(ledger)}</td>
      <td className={Math.abs(difference) <= 0.02 ? "money-positive" : "money-negative"}>
        <strong>{difference > 0 ? "+" : ""}{formatCurrency(difference)}</strong>
      </td>
    </tr>
  );
}

async function recognizeImages(images: Blob[]): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(["deu", "eng"]);
  try {
    const parts: string[] = [];
    for (const image of images) {
      const result = await worker.recognize(image);
      if (result.data.text.trim()) parts.push(result.data.text.trim());
    }
    return parts.join("\n");
  } finally {
    await worker.terminate();
  }
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
