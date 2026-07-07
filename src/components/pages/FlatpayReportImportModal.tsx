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
import { Badge, Button, Field, Input, Modal, StatCard } from "../ui";

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
  const [zeroCash, setZeroCash] = useState("");
  const [zeroCard, setZeroCard] = useState("");
  const [zeroOther, setZeroOther] = useState("0,00");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const validation = useMemo(
    () => report ? validateFlatpaySalesReport(report) : undefined,
    [report],
  );
  const comparison = useMemo(
    () => report ? compareFlatpayReportToLedger(report, state.ledger) : undefined,
    [report, state.ledger],
  );
  const zeroAllocation = roundMoney(
    parseDecimal(zeroCash) + parseDecimal(zeroCard) + parseDecimal(zeroOther),
  );
  const allocationValid = Boolean(
    report && Math.abs(zeroAllocation - report.zeroGross) <= 0.02,
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
      if (!pdf) throw new Error("Bitte einen Flatpay-Umsatzbericht als PDF auswählen.");
      const result = await readPdfForOcr(selected);
      let text = result.embeddedText;
      if (!text.trim() && result.pageImages.length) {
        text = await recognizeImages(result.pageImages);
      }
      if (!text.trim()) throw new Error("Im PDF konnte kein lesbarer Text gefunden werden.");
      const parsed = parseFlatpaySalesReport(text);
      const checked = validateFlatpaySalesReport(parsed);
      if (!checked.valid) throw new Error(checked.issues.join(" "));
      const matched = compareFlatpayReportToLedger(parsed, state.ledger);
      setFile(selected);
      setReport(parsed);
      if (Math.abs(matched.zeroGross - parsed.zeroGross) <= 0.02) {
        setZeroCash(formatInput(matched.cashZero));
        setZeroCard(formatInput(matched.cardZero));
        setZeroOther(formatInput(Math.max(0, matched.zeroGross - matched.cashZero - matched.cardZero)));
      } else if (parsed.zeroGross === 0) {
        setZeroCash("0,00");
        setZeroCard("0,00");
        setZeroOther("0,00");
      } else {
        setZeroCash(formatInput(matched.cashZero));
        setZeroCard(formatInput(matched.cardZero));
        setZeroOther("0,00");
      }
      setInfo(
        result.pageImages.length
          ? `${result.processedPages} PDF-Seite(n) wurden per OCR gelesen.`
          : `${result.processedPages} PDF-Seite(n) wurden direkt ausgelesen.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Der Flatpay-Bericht konnte nicht gelesen werden.");
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!report || !file || !validation?.valid) return;
    setError("");
    try {
      if (!comparison?.exact && !allocationValid) {
        throw new Error(`Die 0-%-Aufteilung muss zusammen ${formatCurrency(report.zeroGross)} ergeben.`);
      }
      const dataUrl = file.size <= MAX_INLINE_BYTES ? await fileToDataUrl(file) : undefined;
      const plan = createFlatpayImportPlan(
        state,
        report,
        {
          zeroCash: parseDecimal(zeroCash),
          zeroCard: parseDecimal(zeroCard),
          zeroOther: parseDecimal(zeroOther),
        },
        file.name,
        dataUrl,
      );
      replaceState({
        ...state,
        documents: [plan.document, ...state.documents],
        ledger: [...plan.entries, ...state.ledger],
      });
      onImported(
        plan.alreadyMatched
          ? `Flatpay-Umsatzbericht ${formatDate(report.startDate)}–${formatDate(report.endDate)} wurde rechnerisch geprüft und archiviert. Vorhandene Buchungen stimmen überein; es wurde nichts doppelt gebucht.`
          : `${plan.entries.length} fehlende Sammelbuchung(en) wurden aus dem geprüften Flatpay-Bericht ergänzt und das PDF wurde archiviert.`,
      );
      reset();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Der Bericht konnte nicht gespeichert werden.");
    }
  }

  function reset() {
    setFile(undefined);
    setReport(undefined);
    setZeroCash("");
    setZeroCard("");
    setZeroOther("0,00");
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
      title="Flatpay-Umsatzbericht importieren"
      wide
      footer={
        <>
          <Button variant="secondary" onClick={close}>Abbrechen</Button>
          <Button
            disabled={!report || !validation?.valid || (!comparison?.exact && !allocationValid) || loading}
            onClick={() => void save()}
          >
            {comparison?.exact ? "Geprüft archivieren" : "Buchhaltung ergänzen"}
          </Button>
        </>
      }
    >
      <div className="form-stack">
        <div className="alert alert-info">
          Das PDF wird automatisch ausgelesen und rechnerisch geprüft. Stimmen bereits vorhandene Umsätze überein, wird nur archiviert. Fehlende Beträge werden als Sammelbuchung zum Berichtsende ergänzt.
        </div>
        {error ? <div className="alert alert-danger">{error}</div> : null}
        {info ? <div className="alert alert-success">{info}</div> : null}
        <Field label="Flatpay-PDF" hint={file?.name || "Umsatzbericht als PDF auswählen"}>
          <Input type="file" accept="application/pdf,.pdf" onChange={(event) => void selectFile(event)} />
        </Field>
        {loading ? <div className="scanner-placeholder"><p>Flatpay-Bericht wird gelesen und geprüft …</p></div> : null}

        {report && comparison ? (
          <>
            <div className="stat-grid">
              <StatCard label="Gesamtumsatz" value={formatCurrency(report.totalSales)} detail={`${formatDate(report.startDate)} – ${formatDate(report.endDate)}`} />
              <StatCard label="Bargeld" value={formatCurrency(report.cashSales - report.cashRefunds)} tone="positive" detail={`Buchhaltung ${formatCurrency(comparison.cash)}`} />
              <StatCard label="Karte" value={formatCurrency(report.cardSales - report.cardRefunds)} tone="blue" detail={`Buchhaltung ${formatCurrency(comparison.card)}`} />
              <StatCard label="MwSt. 19 %" value={formatCurrency(report.standardVat)} tone="negative" detail={`Buchhaltung ${formatCurrency(comparison.standardVat)}`} />
            </div>

            <div className={comparison.exact ? "alert alert-success" : "alert alert-warning"}>
              {comparison.exact
                ? "Alle relevanten Summen stimmen mit der vorhandenen Buchhaltung überein. Das PDF wird ohne Doppelbuchung archiviert."
                : "Es bestehen Differenzen. Das System ergänzt nur fehlende Beträge und blockiert den Import, wenn vorhandene Buchungen den Bericht übersteigen."}
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Kontrolle</th><th>Flatpay</th><th>Buchhaltung</th><th>Differenz</th></tr></thead>
                <tbody>
                  <CheckRow label="Bargeld" report={report.cashSales - report.cashRefunds} ledger={comparison.cash} />
                  <CheckRow label="Karte" report={report.cardSales - report.cardRefunds} ledger={comparison.card} />
                  <CheckRow label="Gesamtumsatz" report={report.totalSales} ledger={comparison.total} />
                  <CheckRow label="0 % Brutto" report={report.zeroGross} ledger={comparison.zeroGross} />
                  <CheckRow label="19 % Brutto" report={report.standardGross} ledger={comparison.standardGross} />
                  <CheckRow label="19 % MwSt." report={report.standardVat} ledger={comparison.standardVat} />
                </tbody>
              </table>
            </div>

            <dl className="detail-list">
              <div><dt>19 % Netto</dt><dd>{formatCurrency(report.standardNet)}</dd></div>
              <div><dt>19 % MwSt.</dt><dd>{formatCurrency(report.standardVat)}</dd></div>
              <div><dt>19 % Brutto</dt><dd>{formatCurrency(report.standardGross)}</dd></div>
              <div><dt>0 % Brutto</dt><dd>{formatCurrency(report.zeroGross)}</dd></div>
              <div><dt>Surcharge</dt><dd>{formatCurrency(report.surcharge)} · bereits im Gesamtumsatz enthalten</dd></div>
              <div><dt>Trinkgeld</dt><dd>{formatCurrency(report.tips)}</dd></div>
            </dl>

            {!comparison.exact && report.zeroGross > 0 ? (
              <div className="split-box">
                <div className="card-heading"><div><h3>0-%-Umsatz aufteilen</h3><p>Im PDF steht nur die Gesamtsumme. Für eine Buchung muss feststehen, welcher Anteil bar, per Karte oder über andere Zahlarten bezahlt wurde.</p></div></div>
                <div className="form-grid three">
                  <Field label="0 % davon Bargeld"><Input inputMode="decimal" value={zeroCash} onChange={(event) => setZeroCash(event.target.value)} /></Field>
                  <Field label="0 % davon Karte"><Input inputMode="decimal" value={zeroCard} onChange={(event) => setZeroCard(event.target.value)} /></Field>
                  <Field label="0 % davon Andere"><Input inputMode="decimal" value={zeroOther} onChange={(event) => setZeroOther(event.target.value)} /></Field>
                </div>
                <div className={`split-total ${allocationValid ? "ok" : "warning"}`}>
                  <span>Aufteilung</span><strong>{formatCurrency(zeroAllocation)} / {formatCurrency(report.zeroGross)}</strong>
                </div>
              </div>
            ) : null}
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

function formatInput(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
