"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { formatCurrency, formatDate } from "@/lib/accounting";
import {
  createUnitelCashImportPlan,
  parseUnitelCashReport,
  type UnitelCashImportPlan,
} from "@/lib/unitel-cash-import";
import type { UnitelDailyReport } from "@/lib/unitel-daily-report";
import { useKassenStore } from "@/lib/store";
import { Badge, Button, Field, Input, Modal, StatCard } from "../ui";

const MAX_INLINE_BYTES = 3 * 1024 * 1024;

export function UnitelCashImportModal({
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
  const [fileDataUrl, setFileDataUrl] = useState<string>();
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const planned = useMemo<{ plan?: UnitelCashImportPlan; error?: string }>(() => {
    if (!file || !report) return {};
    try {
      return { plan: createUnitelCashImportPlan(state, report, file.name, fileDataUrl) };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : "Der Importplan konnte nicht erstellt werden." };
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
    setReport(undefined);
    setFileDataUrl(undefined);
    try {
      const allowed = /\.(txt|csv|tsv)$/i.test(selected.name) || /text|csv/i.test(selected.type);
      if (!allowed) throw new Error("Bitte die Pin-Sales-/UniTel-Liste als TXT, TSV oder CSV auswählen.");
      const parsed = parseUnitelCashReport(await selected.text());
      setFile(selected);
      setReport(parsed);
      setFileDataUrl(selected.size <= MAX_INLINE_BYTES ? await fileToDataUrl(selected) : undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Die Unitel-Verkaufsliste konnte nicht gelesen werden.");
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
      `${report.dayCount} Unitel-Verkaufstage wurden geprüft.`,
      `${plan.importedDays} neue Tagessumme(n) wurden vollständig als Barverkauf in Kasse 1000 gegen 1590 gebucht.`,
      plan.skippedExistingDays ? `${plan.skippedExistingDays} bereits aus MeinBuch vorhandene Tagessumme(n) wurden nicht doppelt gebucht.` : "",
      `${plan.commissionEntries} neue Monatsprovision(en) wurden auf 8403 mit 19 % Umsatzsteuer gebucht.`,
      plan.skippedExistingCommissions ? `${plan.skippedExistingCommissions} vorhandene Provision(en) wurden übersprungen.` : "",
    ].filter(Boolean).join(" "));
    reset();
    onClose();
  }

  function reset() {
    setFile(undefined);
    setReport(undefined);
    setFileDataUrl(undefined);
    setReading(false);
    setError("");
  }

  function close() { reset(); onClose(); }

  return <Modal
    open={open}
    onClose={close}
    title="Unitel-Guthaben vollständig als Barverkauf importieren"
    wide
    footer={<><Button variant="secondary" onClick={close}>Abbrechen</Button><Button disabled={!plan || reading || Boolean(plan.conflicts.length)} onClick={save}>{plan ? `${plan.importedDays} Tage buchen` : "Importieren"}</Button></>}
  >
    <div className="form-stack">
      <div className="alert alert-info"><strong>Fest bestätigte Geschäftsregel:</strong> Diese Pin-Sales-/Unitel-Verkäufe wurden vollständig bar kassiert und erscheinen nicht im Flatpay-Kassensystem. Deshalb wird jede Tagessumme automatisch in Kasse 1000 gegen Unitel-Verrechnung 1590 gebucht.</div>
      <Field label="Pin-Sales-/Unitel-Verkaufsliste" hint={file?.name || "TXT, TSV oder CSV; auch ohne Kopfzeile"}><Input type="file" accept=".txt,.tsv,.csv,text/plain,text/tab-separated-values,text/csv" onChange={(event) => void selectFile(event)} /></Field>
      {reading ? <div className="alert alert-info">Produktzeilen, Stückzahlen, Tageswerte und Gesamtsumme werden geprüft …</div> : null}
      {visibleError ? <div className="alert alert-danger">{visibleError}</div> : null}
      {report && plan ? <>
        <div className="stat-grid">
          <StatCard label="Bar verkauft" value={formatCurrency(report.salesTotal)} detail={`${formatDate(report.startDate)} – ${formatDate(report.endDate)}`} />
          <StatCard label="Unitel-Verrechnung" value={formatCurrency(report.purchaseTotal)} tone="blue" detail="Durchlaufender Posten 1590" />
          <StatCard label="Provision brutto" value={formatCurrency(report.profit)} tone="positive" detail="8403 · 19 % USt." />
          <StatCard label="Verkaufstage" value={String(report.dayCount)} detail={`${report.quantity} Aufladungen · ${report.lineCount} Produktzeilen`} />
        </div>
        <div className="calculation-box">
          <h3>Automatische Buchung</h3>
          <div><span>Neue Bar-Tagessummen</span><strong>{plan.importedDays}</strong></div>
          <div><span>Bereits aus MeinBuch vorhanden</span><strong>{plan.skippedExistingDays}</strong></div>
          <div><span>Neue Monatsprovisionen</span><strong>{plan.commissionEntries}</strong></div>
          <div><span>Erzeugte Buchungszeilen</span><strong>{plan.entries.length}</strong></div>
        </div>
        {plan.conflicts.length ? <div className="alert alert-danger"><strong>Import gesperrt:</strong> {plan.conflicts.length} Tag(e) besitzen bereits einen abweichenden Unitel-Kassenbetrag. Diese Tage müssen zuerst geprüft werden.<div className="table-wrap"><table className="data-table"><thead><tr><th>Datum</th><th className="align-right">Liste</th><th className="align-right">Vorhanden</th><th className="align-right">Differenz</th></tr></thead><tbody>{plan.conflicts.slice(0, 20).map((conflict) => <tr key={conflict.date}><td>{formatDate(conflict.date)}</td><td className="align-right">{formatCurrency(conflict.reportTotal)}</td><td className="align-right">{formatCurrency(conflict.existingTotal)}</td><td className="align-right">{formatCurrency(conflict.difference)}</td></tr>)}</tbody></table></div></div> : null}
        {!plan.conflicts.length ? <div className="alert alert-success">Alle Tages- und Gesamtsummen sind stimmig. Der vollständige Kundenbetrag erhöht die Barkasse; nur die ausgewiesene Provision ist eigener steuerpflichtiger Ertrag.</div> : null}
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Datum</th><th>Aufladungen</th><th className="align-right">Barverkauf</th><th className="align-right">Unitel-Anteil</th><th className="align-right">Provision</th><th>Status</th></tr></thead><tbody>{report.days.map((day) => { const conflict = plan.conflicts.find((item) => item.date === day.date); const existing = !conflict && plan.entries.every((entry) => !(entry.sourceId?.startsWith("unitel-sales:") && entry.date === day.date)); return <tr key={day.date}><td>{formatDate(day.date)}</td><td>{day.quantity}</td><td className="align-right">{formatCurrency(day.salesTotal)}</td><td className="align-right">{formatCurrency(day.purchaseTotal)}</td><td className="align-right">{formatCurrency(day.profit)}</td><td>{conflict ? <Badge tone="warning">Differenz</Badge> : existing ? <Badge>Schon vorhanden</Badge> : <Badge tone="success">Bar buchen</Badge>}</td></tr>; })}</tbody></table></div>
      </> : null}
    </div>
  </Modal>;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
