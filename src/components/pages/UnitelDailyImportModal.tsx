"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { formatCurrency, formatDate } from "@/lib/accounting";
import { parseDecimal } from "@/lib/invoice-validation";
import { useKassenStore } from "@/lib/store";
import {
  createUnitelDailyImportPlan,
  parseUnitelDailyReport,
  type UnitelDailyReport,
  type UnitelMonthSummary,
} from "@/lib/unitel-daily-report";
import type { BusinessDocument } from "@/lib/types";
import { Badge, Button, Field, Input, Modal, StatCard } from "../ui";

const MAX_INLINE_BYTES = 3 * 1024 * 1024;
type AllocationMode = "" | "cash" | "card" | "manual";

export function UnitelDailyImportModal({
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
  const [report, setReport] = useState<UnitelDailyReport>();
  const [mode, setMode] = useState<AllocationMode>("");
  const [manualCash, setManualCash] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const allocation = useMemo(() => {
    if (!report || !mode) return undefined;
    const result: Record<string, number> = {};
    for (const day of report.days) {
      result[day.date] = mode === "cash"
        ? day.salesTotal
        : mode === "card"
          ? 0
          : parseDecimal(manualCash[day.date] || "");
    }
    return result;
  }, [manualCash, mode, report]);

  const allocationValid = Boolean(report && allocation && report.days.every((day) => {
    if (mode === "manual" && !manualCash[day.date]?.trim()) return false;
    const cash = allocation[day.date];
    return Number.isFinite(cash) && cash >= 0 && cash <= day.salesTotal + 0.02;
  }));

  const cashTotal = report && allocation
    ? roundMoney(report.days.reduce((sum, day) => sum + allocation[day.date], 0))
    : 0;
  const cardTotal = report ? roundMoney(report.salesTotal - cashTotal) : 0;

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;
    setError("");
    setInfo("");
    setReport(undefined);
    setMode("");
    setManualCash({});
    setLoading(true);
    try {
      const allowed = /\.(txt|csv|tsv)$/i.test(selected.name) || /text|csv/i.test(selected.type);
      if (!allowed) throw new Error("Bitte die Pin-Sales-Tagesliste als TXT, TSV oder CSV auswählen.");
      const parsed = parseUnitelDailyReport(await selected.text());
      setFile(selected);
      setReport(parsed);
      setManualCash(Object.fromEntries(parsed.days.map((day) => [day.date, ""])));
      setInfo(
        `${parsed.lineCount} Produktzeilen, ${parsed.quantity} Aufladungen und ${parsed.dayCount} Verkaufstage wurden rechnerisch geprüft.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Die Tagesliste konnte nicht gelesen werden.");
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!report || !file || !allocation || !allocationValid) return;
    setError("");
    try {
      const dataUrl = file.size <= MAX_INLINE_BYTES ? await fileToDataUrl(file) : undefined;
      const plan = createUnitelDailyImportPlan(state, report, allocation, file.name, dataUrl);
      replaceState({
        ...state,
        documents: [plan.document, ...state.documents],
        ledger: [...plan.entries, ...state.ledger],
      });
      onImported(
        `${report.dayCount} UniTel-Tagessummen wurden übernommen: ${formatCurrency(cashTotal)} bar und ${formatCurrency(cardTotal)} Karte. ` +
          `${plan.commissionEntries} monatliche Provisionsbuchung(en) wurden erstellt. Die ${report.lineCount} Produktzeilen bleiben im Originalbeleg archiviert.`,
      );
      reset();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Die Tagesliste konnte nicht importiert werden.");
    }
  }

  function reset() {
    setFile(undefined);
    setReport(undefined);
    setMode("");
    setManualCash({});
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
      title="UniTel-Tagesverkäufe importieren"
      wide
      footer={
        <>
          <Button variant="secondary" onClick={close}>Abbrechen</Button>
          <Button disabled={!allocationValid || loading} onClick={() => void save()}>
            Tagessummen ins Kassenbuch übernehmen
          </Button>
        </>
      }
    >
      <div className="form-stack">
        <div className="alert alert-info">
          Die Datei enthält Produkt, Stückzahl, Einkaufssumme, Verkaufssumme, Gewinn und Datum, aber keine Zahlungsart. Deshalb werden die Verkäufe offiziell als Tagessummen gebucht und die Aufteilung Bar/Karte muss vor dem Import bestätigt werden.
        </div>
        {error ? <div className="alert alert-danger">{error}</div> : null}
        {info ? <div className="alert alert-success">{info}</div> : null}
        <Field label="Pin-Sales-/UniTel-Tagesliste" hint={file?.name || "TXT, TSV oder CSV auswählen"}>
          <Input type="file" accept=".txt,.tsv,.csv,text/plain,text/tab-separated-values,text/csv" onChange={(event) => void selectFile(event)} />
        </Field>
        {loading ? <div className="scanner-placeholder"><p>Tagesliste wird gelesen und rechnerisch geprüft …</p></div> : null}

        {report ? (
          <>
            <div className="stat-grid">
              <StatCard label="Verkaufssumme" value={formatCurrency(report.salesTotal)} detail={`${formatDate(report.startDate)} – ${formatDate(report.endDate)}`} />
              <StatCard label="An UniTel" value={formatCurrency(report.purchaseTotal)} tone="blue" detail="Einkaufssumme / Abrechnung" />
              <StatCard label="Provision Brutto" value={formatCurrency(report.profit)} tone="positive" detail={`${report.quantity} Aufladungen`} />
              <StatCard label="Verkaufstage" value={String(report.dayCount)} detail={`${report.lineCount} Produktzeilen`} />
            </div>

            <div className="card-heading">
              <div>
                <h3>Zahlungsart festlegen</h3>
                <p>Die Quelldatei trennt Bar und Karte nicht. Ohne Bestätigung wird nichts gebucht.</p>
              </div>
              <div className="document-actions">
                <Button variant={mode === "cash" ? "primary" : "secondary"} onClick={() => setMode("cash")}>Alles bar</Button>
                <Button variant={mode === "card" ? "primary" : "secondary"} onClick={() => setMode("card")}>Alles Karte</Button>
                <Button variant={mode === "manual" ? "primary" : "secondary"} onClick={() => setMode("manual")}>Tagesweise aufteilen</Button>
              </div>
            </div>

            {!mode ? (
              <div className="alert alert-warning">
                Bitte „Alles bar“, „Alles Karte“ oder „Tagesweise aufteilen“ auswählen. Das Programm darf die fehlende Zahlungsart nicht selbst erfinden.
              </div>
            ) : (
              <div className="calculation-box">
                <h3>Aufteilung</h3>
                <div><span>Bar / Kassenwirkung</span><strong>{formatCurrency(cashTotal)}</strong></div>
                <div><span>Karte / Geldtransit</span><strong>{formatCurrency(cardTotal)}</strong></div>
                <div><span>Gesamt</span><strong>{formatCurrency(cashTotal + cardTotal)} / {formatCurrency(report.salesTotal)}</strong></div>
              </div>
            )}

            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Monat</th><th>Verkauf</th><th>UniTel-Abrechnung</th><th>Provision</th><th>Monats-PDF</th></tr></thead>
                <tbody>{report.months.map((month) => <MonthRow key={month.month} month={month} documents={state.documents} />)}</tbody>
              </table>
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Datum</th><th>Aufladungen</th><th>Verkauf</th><th>Einkauf</th><th>Provision</th><th>Bar</th><th>Karte</th></tr></thead>
                <tbody>{report.days.map((day) => {
                  const cash = allocation?.[day.date] || 0;
                  const card = roundMoney(day.salesTotal - cash);
                  return <tr key={day.date}>
                    <td><strong>{formatDate(day.date)}</strong><small>{day.lineCount} Produktzeilen</small></td>
                    <td>{day.quantity}</td>
                    <td>{formatCurrency(day.salesTotal)}</td>
                    <td>{formatCurrency(day.purchaseTotal)}</td>
                    <td>{formatCurrency(day.profit)}</td>
                    <td>{mode === "manual" ? <Input inputMode="decimal" value={manualCash[day.date] || ""} placeholder="0,00" onChange={(event) => setManualCash((current) => ({ ...current, [day.date]: event.target.value }))} /> : formatCurrency(cash)}</td>
                    <td className={card < -0.02 ? "money-negative" : ""}>{formatCurrency(card)}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>

            <div className="alert alert-info">
              Pro Verkaufstag entstehen höchstens zwei Sammelbuchungen: Bar erhöht den physischen Kassenbestand, Karte läuft über Geldtransit. Zusätzlich wird die im Export ausgewiesene Provision einmal je Monat mit 19 % Umsatzsteuer gebucht. Die einzelnen 698 Produktzeilen werden nicht als 698 Kassenbuchzeilen vervielfacht, bleiben aber vollständig im archivierten Original erhalten.
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

function MonthRow({ month, documents }: { month: UnitelMonthSummary; documents: BusinessDocument[] }) {
  const invoice = documents.find((document) =>
    document.metadata?.provider === "UniTel" &&
    document.metadata?.reportKind === "Guthaben-Monatsabrechnung" &&
    typeof document.metadata?.periodStart === "string" &&
    document.metadata.periodStart.slice(0, 7) === month.month,
  );
  if (!invoice) {
    return <tr>
      <td><strong>{monthLabel(month.month)}</strong><small>{month.dayCount} Verkaufstage</small></td>
      <td>{formatCurrency(month.salesTotal)}</td>
      <td>{formatCurrency(month.purchaseTotal)}</td>
      <td>{formatCurrency(month.profit)}</td>
      <td><Badge tone="warning">Noch kein Monats-PDF</Badge></td>
    </tr>;
  }
  const invoiceSales = metadataNumber(invoice, "totalCardValue");
  const invoicePayable = metadataNumber(invoice, "payableAmount");
  const invoiceCommission = metadataNumber(invoice, "commissionGross");
  const exact = close(invoiceSales, month.salesTotal) && close(invoicePayable, month.purchaseTotal) && close(invoiceCommission, month.profit);
  return <tr>
    <td><strong>{monthLabel(month.month)}</strong><small>{month.dayCount} Verkaufstage</small></td>
    <td>{formatCurrency(month.salesTotal)}<small>PDF {formatCurrency(invoiceSales)}</small></td>
    <td>{formatCurrency(month.purchaseTotal)}<small>PDF {formatCurrency(invoicePayable)}</small></td>
    <td>{formatCurrency(month.profit)}<small>PDF {formatCurrency(invoiceCommission)}</small></td>
    <td><Badge tone={exact ? "success" : "warning"}>{exact ? "Stimmt überein" : "Differenz prüfen"}</Badge></td>
  </tr>;
}

function metadataNumber(document: BusinessDocument, key: string): number {
  const value = document.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function monthLabel(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, number - 1, 1)));
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function close(left: number, right: number): boolean {
  return Math.abs(roundMoney(left - right)) <= 0.02;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
