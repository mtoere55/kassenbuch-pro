"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { formatCurrency, formatDate, makeId } from "@/lib/accounting";
import { parseCashbookBackup, planBackupImport, type CashbookBackup } from "@/lib/backup-reader";
import { normalizeMeinbuchImportEntries } from "@/lib/kas-import-normalizer";
import { useKassenStore } from "@/lib/store";
import type { BusinessDocument } from "@/lib/types";
import { Badge, Button, Field, Input, Modal } from "../ui";

export function MeinbuchImportModal({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (message: string) => void;
}) {
  const { state, replaceState } = useKassenStore();
  const [backup, setBackup] = useState<CashbookBackup>();
  const [fileName, setFileName] = useState("");
  const [fileDataUrl, setFileDataUrl] = useState<string>();
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const rawPlan = useMemo(
    () => (backup ? planBackupImport(backup, state.ledger, fileName || "MeinBuch-Backup") : undefined),
    [backup, fileName, state.ledger],
  );
  const entries = useMemo(
    () => normalizeMeinbuchImportEntries(rawPlan?.entries || []),
    [rawPlan?.entries],
  );
  const unresolved = entries.filter((entry) => entry.accountCode === "0000").length;
  const archiveExists = Boolean(backup && state.documents.some(
    (document) => document.metadata?.meinbuchBackupFingerprint === backup.fingerprint,
  ));
  const categoryNames = useMemo(
    () => new Map(backup?.categories.map((category) => [category.code, category.name]) || []),
    [backup],
  );

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setBackup(undefined);
    setFileDataUrl(undefined);
    setFileName(file.name);
    setReading(true);
    try {
      if (!file.name.toLowerCase().endsWith(".kas")) throw new Error("Bitte eine MeinBuch-Datei mit der Endung .kas auswählen.");
      const buffer = await file.arrayBuffer();
      const parsed = parseCashbookBackup(buffer);
      setBackup(parsed);
      setFileDataUrl(await toDataUrl(file));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Die MeinBuch-Datei konnte nicht gelesen werden.");
    } finally {
      setReading(false);
      event.target.value = "";
    }
  }

  function importEntries() {
    if (!backup || !rawPlan) return;
    const archiveDocument = archiveExists ? undefined : createArchiveDocument(backup, fileName, fileDataUrl);
    if (!entries.length && !archiveDocument) return;
    replaceState({
      ...state,
      documents: archiveDocument ? [archiveDocument, ...state.documents] : state.documents,
      ledger: [...entries, ...state.ledger],
    });
    const parts = [
      `${entries.length} MeinBuch-Buchung(en) wurden mit Originaldatum, Text, Betrag und Vorzeichen übernommen.`,
      rawPlan.duplicateCount ? `${rawPlan.duplicateCount} bereits vorhandene Datensätze wurden übersprungen.` : "",
      unresolved ? `${unresolved} inhaltlich nicht erkennbare Altbuchung(en) bleiben auf Konto 0000.` : "Alle erkennbaren Altbuchungen wurden kontiert.",
      archiveDocument ? "Die originale .kas-Datei wurde als Quelldatei archiviert." : "Die Quelldatei war bereits archiviert.",
    ].filter(Boolean);
    onImported(parts.join(" "));
    reset();
    onClose();
  }

  function reset() {
    setBackup(undefined);
    setFileName("");
    setFileDataUrl(undefined);
    setError("");
  }

  function close() { reset(); onClose(); }
  const sample = backup?.transactions.slice(0, 15) || [];

  return <Modal
    open={open}
    title="MeinBuch-.kas vollständig übernehmen"
    onClose={close}
    wide
    footer={<><Button variant="secondary" onClick={close}>Abbrechen</Button><Button disabled={reading || (!entries.length && archiveExists)} onClick={importEntries}>{entries.length ? `${entries.length} Buchungen übernehmen` : "Quelldatei archivieren"}</Button></>}
  >
    <div className="form-stack">
      <div className="alert alert-info"><strong>Historischer Originalimport:</strong> Datum, Beschreibung, Betrag, Vorzeichen und Kassenwirkung bleiben unverändert. Die alte Kategorie wird zusätzlich auf den neuen Kontenplan abgebildet.</div>
      <Field label="MeinBuch-.kas-Datei" hint={fileName || "Alte Datensicherung auswählen"}><Input type="file" accept=".kas,application/octet-stream" onChange={(event) => void selectFile(event)} /></Field>
      {reading ? <div className="alert alert-info">MeinBuch-Datensicherung wird blockweise geprüft …</div> : null}
      {error ? <div className="alert alert-danger">{error}</div> : null}
      {backup && rawPlan ? <>
        <div className="calculation-box">
          <h3>Prüfergebnis</h3>
          <div><span>Originaldatei</span><strong>{fileName}</strong></div>
          <div><span>Gefundene Datensätze</span><strong>{backup.transactions.length}</strong></div>
          <div><span>Neu zu übernehmen</span><strong>{entries.length}</strong></div>
          <div><span>Erkannte alte Konten</span><strong>{backup.categories.length}</strong></div>
          <div><span>Zeitraum</span><strong>{backup.startDate && backup.endDate ? `${formatDate(backup.startDate)} – ${formatDate(backup.endDate)}` : "–"}</strong></div>
          <div><span>Positive Buchungen</span><strong>{formatCurrency(backup.incomeTotal)}</strong></div>
          <div><span>Negative Buchungen</span><strong>{formatCurrency(backup.expenseTotal)}</strong></div>
          <div><span>Bereits vorhanden</span><strong>{rawPlan.duplicateCount}</strong></div>
          <div><span>Noch nicht eindeutig</span><strong>{unresolved}</strong></div>
        </div>
        {unresolved ? <div className="alert alert-warning">Nur {unresolved} Datensatz/Datensätze ohne ausreichenden Text bleiben auf Konto 0000. Unitel, Ria/MoneyGram, Prifoto, Bank/Geldtransit, Privat, Lyca, Action, Müller, Netto und §25a werden automatisch eingeordnet.</div> : null}
        <div className="card-heading"><div><h3>Originalvorschau</h3><p>Die ersten {sample.length} Datensätze; die vollständige Datei wird übernommen.</p></div><div className="badge-row"><Badge tone="success">{entries.length} neu</Badge>{archiveExists ? <Badge>Quelle archiviert</Badge> : <Badge tone="info">Quelle wird archiviert</Badge>}</div></div>
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Datum</th><th>Original-ID</th><th>Text</th><th>Altkonto</th><th>MwSt.</th><th className="align-right">Betrag</th></tr></thead><tbody>{sample.map((transaction) => <tr key={transaction.recordId}><td>{formatDate(transaction.date)}</td><td>KAS-{transaction.recordId}</td><td>{transaction.description || "Ohne Text"}</td><td><strong>{transaction.categoryCode || "0000"}</strong><small>{categoryNames.get(transaction.categoryCode) || "Regelzuordnung"}</small></td><td>{transaction.taxRate ? `${transaction.taxRate} %` : "–"}</td><td className={`align-right ${transaction.signedAmount >= 0 ? "money-positive" : "money-negative"}`}><strong>{transaction.signedAmount >= 0 ? "+" : "−"}{formatCurrency(Math.abs(transaction.signedAmount))}</strong></td></tr>)}</tbody></table></div>
      </> : null}
    </div>
  </Modal>;
}

function createArchiveDocument(backup: CashbookBackup, fileName: string, fileDataUrl?: string): BusinessDocument {
  return {
    id: makeId("document"),
    documentNumber: `MEINBUCH-${(backup.startDate || "START").replaceAll("-", "")}-${(backup.endDate || "ENDE").replaceAll("-", "")}`,
    type: "zReport",
    date: backup.endDate || backup.startDate || new Date().toISOString().slice(0, 10),
    amount: backup.incomeTotal,
    taxAmount: 0,
    taxMode: "taxFree",
    status: "archived",
    originalFileName: fileName,
    originalImageDataUrl: fileDataUrl,
    metadata: {
      provider: "MeinBuch",
      reportKind: "KAS-Datensicherung",
      periodStart: backup.startDate || null,
      periodEnd: backup.endDate || null,
      transactionCount: backup.transactions.length,
      categoryCount: backup.categories.length,
      incomeTotal: backup.incomeTotal,
      expenseTotal: backup.expenseTotal,
      meinbuchBackupFingerprint: backup.fingerprint,
      internallyValidated: true,
    },
    createdAt: new Date().toISOString(),
  };
}

function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
