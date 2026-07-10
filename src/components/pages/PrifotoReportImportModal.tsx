"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { formatCurrency, formatDate } from "@/lib/accounting";
import { parseDecimal } from "@/lib/invoice-validation";
import { readPdfForOcr } from "@/lib/pdf-reader";
import {
  createPrifotoImportPlan,
  parsePrifotoDetailReport,
  parsePrifotoSalesReport,
  validatePrifotoSalesReport,
  type PrifotoSalesReport,
} from "@/lib/prifoto-report";
import { useKassenStore } from "@/lib/store";
import { Button, Field, Input, Modal, StatCard } from "../ui";

const MAX_INLINE_BYTES = 3 * 1024 * 1024;
type AllocationMode = "" | "cash" | "card" | "manual";

export function PrifotoReportImportModal({
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
  const [detailFile, setDetailFile] = useState<File>();
  const [report, setReport] = useState<PrifotoSalesReport>();
  const [mode, setMode] = useState<AllocationMode>("");
  const [manualCash, setManualCash] = useState<Record<string, string>>({});
  const [prifotoShare, setPrifotoShare] = useState("");
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const validation = useMemo(() => report ? validatePrifotoSalesReport(report) : undefined, [report]);
  const prifotoShareAmount = parseDecimal(prifotoShare);
  const ownShareAmount = report ? roundMoney(report.totalSales - prifotoShareAmount) : 0;
  const shareValid = Boolean(report && Number.isFinite(prifotoShareAmount) && prifotoShareAmount >= 0 && prifotoShareAmount <= report.totalSales + 0.02);
  const allocation = useMemo(() => {
    if (!report || !mode) return undefined;
    const result: Record<string, number> = {};
    for (const day of report.days) result[day.date] = mode === "cash" ? day.amount : mode === "card" ? 0 : parseDecimal(manualCash[day.date] || "");
    return result;
  }, [manualCash, mode, report]);
  const allocationValid = Boolean(report && allocation && report.days.every((day) => {
    if (mode === "manual" && !manualCash[day.date]?.trim()) return false;
    const cash = allocation[day.date];
    return Number.isFinite(cash) && cash >= 0 && cash <= day.amount + 0.02;
  }));
  const cashTotal = report && allocation ? roundMoney(report.days.reduce((sum, day) => sum + allocation[day.date], 0)) : 0;
  const cardTotal = report ? roundMoney(report.totalSales - cashTotal) : 0;

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;
    setError("");
    setInfo("");
    setReport(undefined);
    setMode("");
    setManualCash({});
    setPrifotoShare("");
    setDetailFile(undefined);
    setLoading(true);
    try {
      await assertPdfFile(selected, "Bitte den Prifoto-Umsatzbericht als PDF auswählen.");
      const text = await readPdfText(selected);
      const parsed = parsePrifotoSalesReport(text);
      setFile(selected);
      setReport(parsed);
      setPrifotoShare(formatInput(roundMoney(parsed.totalSales / 2)));
      setManualCash(Object.fromEntries(parsed.days.map((day) => [day.date, ""])));
      setInfo("Prifoto-Tagesverkäufe wurden gelesen und rechnerisch geprüft.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Der Prifoto-Bericht konnte nicht gelesen werden.");
    } finally {
      setLoading(false);
    }
  }

  async function selectDetailFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;
    setError("");
    setDetailLoading(true);
    try {
      await assertPdfFile(selected, "Bitte die Prifoto-Detail-Abrechnung als PDF auswählen.");
      const text = await readPdfText(selected);
      const detail = parsePrifotoDetailReport(text);
      setDetailFile(selected);
      setPrifotoShare(formatInput(detail.prifotoShareGross));
      setInfo(`Detail-Abrechnung gelesen: Anteil Prifoto ${formatCurrency(detail.prifotoShareGross)}, eigener Bruttoanteil ${formatCurrency(detail.ownShareGross)}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Die Prifoto-Detail-Abrechnung konnte nicht gelesen werden.");
    } finally {
      setDetailLoading(false);
    }
  }

  async function save() {
    if (!report || !file || !allocation || !allocationValid || !validation?.valid || !shareValid) return;
    setError("");
    try {
      const dataUrl = file.size <= MAX_INLINE_BYTES ? await fileToDataUrl(file) : undefined;
      const plan = createPrifotoImportPlan(state, report, allocation, prifotoShareAmount, file.name, dataUrl);
      replaceState({ ...state, documents: [plan.document, ...state.documents], ledger: [...plan.entries, ...state.ledger] });
      onImported(
        `Prifoto ${report.periodLabel} wurde übernommen: Kundenzahlungen ${formatCurrency(report.totalSales)}, ` +
        `Prifoto-Anteil ${formatCurrency(plan.prifotoShareGross)}, eigener Bruttoanteil ${formatCurrency(plan.ownShareGross)}. ` +
        `${plan.clearingEntries} Clearing-Buchung(en) und ${plan.revenueEntries} Erlösbuchung(en) wurden erstellt.`,
      );
      reset();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Der Prifoto-Bericht konnte nicht importiert werden.");
    }
  }

  function reset() {
    setFile(undefined);
    setDetailFile(undefined);
    setReport(undefined);
    setMode("");
    setManualCash({});
    setPrifotoShare("");
    setLoading(false);
    setDetailLoading(false);
    setError("");
    setInfo("");
  }

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="Prifoto-Tagesverkäufe importieren" wide footer={<><Button variant="secondary" onClick={() => { reset(); onClose(); }}>Abbrechen</Button><Button disabled={!allocationValid || !shareValid || loading || detailLoading || !validation?.valid} onClick={() => void save()}>Tagesverkäufe buchen</Button></>}>
      <div className="form-stack">
        <div className="alert alert-info">Auch PDF-Dateien ohne .pdf-Endung werden jetzt erkannt. Zuerst die Tagesverkäufe laden, danach optional die Detail-Abrechnung laden; der Prifoto-Anteil wird dann automatisch übernommen.</div>
        {error ? <div className="alert alert-danger">{error}</div> : null}
        {info ? <div className="alert alert-success">{info}</div> : null}
        <Field label="Prifoto Tagesverkäufe" hint={file?.name || "Umsatzbericht / Tagesverkäufe auswählen, auch ohne .pdf-Endung"}>
          <Input type="file" accept="application/pdf,.pdf,*/*" onChange={(event) => void selectFile(event)} />
        </Field>
        <Field label="Prifoto Detail-Abrechnung" hint={detailFile?.name || "Optional: Detail-PDF für Anteil Prifoto automatisch lesen"}>
          <Input type="file" accept="application/pdf,.pdf,*/*" onChange={(event) => void selectDetailFile(event)} />
        </Field>
        {loading ? <div className="scanner-placeholder"><p>Prifoto-Tagesverkäufe werden gelesen und geprüft …</p></div> : null}
        {detailLoading ? <div className="scanner-placeholder"><p>Prifoto-Detail wird gelesen …</p></div> : null}

        {report ? <>
          <div className="stat-grid">
            <StatCard label="Kundenzahlungen" value={formatCurrency(report.totalSales)} detail={`${formatDate(report.startDate)} – ${formatDate(report.endDate)}`} />
            <StatCard label="Anteil Prifoto" value={formatCurrency(prifotoShareAmount)} tone="negative" detail="laut Detail-Abrechnung" />
            <StatCard label="Eigener Bruttoanteil" value={formatCurrency(ownShareAmount)} tone="positive" detail="als 19-%-Erlös" />
            <StatCard label="Bestellungen" value={String(report.orderCount)} tone="blue" detail={`${report.days.length} Verkaufstage`} />
          </div>
          <Field label="Anteil Prifoto / Gesamtbetrag Brutto" hint="Aus der Detail-Abrechnung. Beim aktuellen PDF: 240,00 €. Kann auch manuell eingetragen werden.">
            <Input inputMode="decimal" value={prifotoShare} onChange={(event) => setPrifotoShare(event.target.value)} />
          </Field>
          {!shareValid ? <div className="alert alert-danger">Der Prifoto-Anteil muss zwischen 0,00 € und {formatCurrency(report.totalSales)} liegen.</div> : null}
          <div className="calculation-box"><h3>Prifoto-Buchungslogik</h3><div><span>Kundenzahlungen ins Clearing 1592</span><strong>{formatCurrency(report.totalSales)}</strong></div><div><span>Davon an Prifoto / bleibt als Verbindlichkeit</span><strong>{formatCurrency(prifotoShareAmount)}</strong></div><div><span>Eigener Bruttoerlös 8400</span><strong>{formatCurrency(ownShareAmount)}</strong></div></div>
          <div className="card-heading"><div><h3>Zahlungsart festlegen</h3><p>Der Bericht zeigt Umsatz und Bestellungen, aber keine sichere Bar/Karte-Trennung. Ohne Bestätigung wird nichts gebucht.</p></div><div className="document-actions"><Button variant={mode === "cash" ? "primary" : "secondary"} onClick={() => setMode("cash")}>Alles bar</Button><Button variant={mode === "card" ? "primary" : "secondary"} onClick={() => setMode("card")}>Alles Karte</Button><Button variant={mode === "manual" ? "primary" : "secondary"} onClick={() => setMode("manual")}>Tagesweise aufteilen</Button></div></div>
          {!mode ? <div className="alert alert-warning">Bitte „Alles bar“, „Alles Karte“ oder „Tagesweise aufteilen“ auswählen.</div> : <div className="calculation-box"><h3>Aufteilung Kundenzahlungen</h3><div><span>Bar / Kassenwirkung</span><strong>{formatCurrency(cashTotal)}</strong></div><div><span>Karte / Geldtransit</span><strong>{formatCurrency(cardTotal)}</strong></div><div><span>Gesamt</span><strong>{formatCurrency(cashTotal + cardTotal)} / {formatCurrency(report.totalSales)}</strong></div></div>}
          <div className="table-wrap"><table className="data-table"><thead><tr><th>Datum</th><th>Wochentag</th><th>Bestellungen</th><th>Kundenzahlung</th><th>Bar</th><th>Karte</th></tr></thead><tbody>{report.days.map((day) => { const cash = allocation?.[day.date] || 0; const card = roundMoney(day.amount - cash); return <tr key={day.date}><td><strong>{formatDate(day.date)}</strong></td><td>{day.weekday}</td><td>{day.orders}</td><td>{formatCurrency(day.amount)}</td><td>{mode === "manual" ? <Input inputMode="decimal" value={manualCash[day.date] || ""} placeholder="0,00" onChange={(event) => setManualCash((current) => ({ ...current, [day.date]: event.target.value }))} /> : formatCurrency(cash)}</td><td className={card < -0.02 ? "money-negative" : ""}>{formatCurrency(card)}</td></tr>; })}</tbody></table></div>
          {report.products.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Produktanteile aus PDF</th><th>Umsatz</th><th>Anteil</th></tr></thead><tbody>{report.products.map((product) => <tr key={product.name}><td>{product.name}</td><td>{formatCurrency(product.amount)}</td><td>{product.sharePercent.toLocaleString("de-DE")} %</td></tr>)}</tbody></table></div> : null}
        </> : null}
      </div>
    </Modal>
  );
}

async function assertPdfFile(file: File, message: string) {
  const header = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  const signature = String.fromCharCode(...header);
  if (signature !== "%PDF-") throw new Error(message);
}

async function readPdfText(file: File): Promise<string> {
  const result = await readPdfForOcr(file);
  let text = result.embeddedText;
  if (!text.trim() && result.pageImages.length) text = await recognizeImages(result.pageImages);
  if (!text.trim()) throw new Error("Im PDF konnte kein lesbarer Text gefunden werden.");
  return text;
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
function formatInput(value: number): string { return value.toFixed(2).replace(".", ","); }
function roundMoney(value: number): number { return Math.round((value + Number.EPSILON) * 100) / 100; }
