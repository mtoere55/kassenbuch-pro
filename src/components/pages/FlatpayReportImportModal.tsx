"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { formatCurrency, formatDate } from "@/lib/accounting";
import {
  compareFlatpayReportToLedger,
  createFlatpayImportPlan,
  parseFlatpaySalesReport,
  validateFlatpaySalesReport,
  type FlatpaySalesReport,
} from "@/lib/flatpay-report";
import { parseDecimal } from "@/lib/invoice-validation";
import { readPdfForOcr } from "@/lib/pdf-reader";
import { useKassenStore } from "@/lib/store";
import { Button, Field, Input, Modal, StatCard } from "../ui";

const MAX_INLINE_BYTES = 3 * 1024 * 1024;

export function FlatpayReportImportModal({
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
  const [report, setReport] = useState<FlatpaySalesReport>();
  const [bookFees, setBookFees] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const validation = useMemo(() => report ? validateFlatpaySalesReport(report) : undefined, [report]);
  const comparison = useMemo(() => report ? compareFlatpayReportToLedger(report, state.ledger) : undefined, [report, state.ledger]);
  const feeAmount = report ? parseDecimal(String(report.feesGross)) : 0;

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;
    setError("");
    setLoading(true);
    try {
      const text = await readPdfText(selected);
      const parsed = parseFlatpaySalesReport(text);
      setFile(selected);
      setReport(parsed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Flatpay-Bericht konnte nicht gelesen werden.");
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!report || !file || !validation?.valid) return;
    try {
      const dataUrl = file.size <= MAX_INLINE_BYTES ? await fileToDataUrl(file) : undefined;
      const plan = createFlatpayImportPlan(state, report, { bookFees, fileName: file.name, fileDataUrl: dataUrl });
      replaceState({ ...state, documents: [plan.document, ...state.documents], ledger: [...plan.entries, ...state.ledger] });
      onImported(`Flatpay ${report.periodLabel} wurde übernommen: ${plan.createdEntries} Buchung(en), ${formatCurrency(report.totalGross)} Umsatzabgleich.`);
      setFile(undefined);
      setReport(undefined);
      setBookFees(false);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Flatpay-Bericht konnte nicht importiert werden.");
    }
  }

  return <Modal open={open} onClose={onClose} title="Flatpay-Umsatzbericht importieren" wide footer={<><Button variant="secondary" onClick={onClose}>Abbrechen</Button><Button disabled={!validation?.valid || loading} onClick={() => void save()}>Bericht übernehmen</Button></>}>
    <div className="form-stack">
      {error ? <div className="alert alert-danger">{error}</div> : null}
      <Field label="Flatpay PDF"><Input type="file" accept="application/pdf,.pdf" onChange={(event) => void selectFile(event)} /></Field>
      {loading ? <div className="scanner-placeholder"><p>PDF wird gelesen …</p></div> : null}
      {report ? <><div className="stat-grid"><StatCard label="Zeitraum" value={report.periodLabel} detail={`${formatDate(report.startDate)} – ${formatDate(report.endDate)}`} /><StatCard label="Umsatz" value={formatCurrency(report.totalGross)} /><StatCard label="Gebühren" value={formatCurrency(feeAmount)} tone="negative" /><StatCard label="Auszahlung" value={formatCurrency(report.payout)} tone="positive" /></div>{validation?.warnings.length ? <div className="alert alert-warning">{validation.warnings.join(" ")}</div> : null}{comparison ? <div className="calculation-box"><h3>Abgleich</h3><div><span>Flatpay Umsatz</span><strong>{formatCurrency(comparison.reportTotal)}</strong></div><div><span>Kassenbuch Karte</span><strong>{formatCurrency(comparison.ledgerCardTotal)}</strong></div><div><span>Differenz</span><strong>{formatCurrency(comparison.difference)}</strong></div></div> : null}<label className="toggle-line"><input type="checkbox" checked={bookFees} onChange={(event) => setBookFees(event.target.checked)} /> Gebühren jetzt als Aufwand buchen</label></> : null}
    </div>
  </Modal>;
}

async function readPdfText(file: File): Promise<string> {
  const result = await readPdfForOcr(file);
  let text = result.embeddedText;
  if (!text.trim() && result.pageImages.length) {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker(["deu", "eng"]);
    try {
      const parts: string[] = [];
      for (const image of result.pageImages) {
        const recognized = await worker.recognize(image);
        parts.push(recognized.data.text);
      }
      text = parts.join("\n");
    } finally {
      await worker.terminate();
    }
  }
  return text;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
