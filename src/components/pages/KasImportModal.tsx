"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { formatCurrency, formatDate } from "@/lib/accounting";
import { buildKasImportPlan, parseKasBackup, type KasParseResult } from "@/lib/kas-import";
import { useKassenStore } from "@/lib/store";
import { Button, Field, Input, Modal } from "../ui";

export function KasImportModal({ open, onClose, onImported }: {
  open: boolean;
  onClose: () => void;
  onImported: (message: string) => void;
}) {
  const { state, replaceState } = useKassenStore();
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<KasParseResult>();
  const [error, setError] = useState("");
  const plan = useMemo(
    () => parsed ? buildKasImportPlan(parsed, state.ledger, fileName) : undefined,
    [parsed, state.ledger, fileName],
  );

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setFileName(file.name);
    try {
      if (!file.name.toLowerCase().endsWith(".kas")) throw new Error("Bitte eine .kas-Datei auswählen.");
      setParsed(parseKasBackup(await file.arrayBuffer()));
    } catch (cause) {
      setParsed(undefined);
      setError(cause instanceof Error ? cause.message : "Die Datei konnte nicht gelesen werden.");
    }
    event.target.value = "";
  }

  function importEntries() {
    if (!plan?.entries.length) return;
    replaceState({ ...state, ledger: [...plan.entries, ...state.ledger] });
    onImported(`${plan.entries.length} Buchungen aus ${fileName} wurden importiert.`);
    setParsed(undefined);
    setFileName("");
    onClose();
  }

  const income = sum(parsed, "income");
  const expense = sum(parsed, "expense");

  return <Modal
    open={open}
    onClose={onClose}
    title="KAS-Backup importieren"
    wide
    footer={<><Button variant="secondary" onClick={onClose}>Abbrechen</Button><Button disabled={!plan?.entries.length} onClick={importEntries}>{plan ? `${plan.entries.length} importieren` : "Importieren"}</Button></>}
  >
    <div className="form-stack">
      <div className="alert alert-info">Die Datei wird lokal geprüft. Vorhandene Buchungen bleiben erhalten; bereits importierte Datensätze werden übersprungen.</div>
      {error ? <div className="alert alert-danger">{error}</div> : null}
      <Field label="KAS-Datei" hint={fileName || "Altes Kassenbuch-Backup auswählen"}>
        <Input type="file" accept=".kas,application/octet-stream" onChange={(event) => void selectFile(event)} />
      </Field>
      {parsed && plan ? <>
        <dl className="detail-list">
          <div><dt>Buchungen gelesen</dt><dd>{parsed.transactions.length}</dd></div>
          <div><dt>Importierbar</dt><dd>{plan.entries.length}</dd></div>
          <div><dt>Bereits vorhanden</dt><dd>{plan.duplicateCount}</dd></div>
          <div><dt>Zeitraum</dt><dd>{parsed.dateFrom && parsed.dateTo ? `${formatDate(parsed.dateFrom)} – ${formatDate(parsed.dateTo)}` : "–"}</dd></div>
          <div><dt>Einnahmen</dt><dd>{formatCurrency(income)}</dd></div>
          <div><dt>Ausgaben</dt><dd>{formatCurrency(expense)}</dd></div>
          <div><dt>Konten erkannt</dt><dd>{parsed.accounts.length}</dd></div>
          <div><dt>Nicht zugeordnet</dt><dd>{parsed.unknownAccountRecords}</dd></div>
        </dl>
        {parsed.unknownAccountRecords ? <div className="alert alert-warning">{parsed.unknownAccountRecords} Buchungen werden als Konto 0000 „Nicht zugeordnet“ übernommen, damit kein Betrag verloren geht.</div> : null}
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Datum</th><th>Text</th><th>Konto</th><th className="align-right">Betrag</th></tr></thead><tbody>{parsed.transactions.slice(0, 20).map((item) => <tr key={item.sourceId}><td>{formatDate(item.date)}</td><td><strong>{item.description || item.accountLabel}</strong><small>KAS {item.recordId}</small></td><td>{item.accountCode || "0000"}<small>{item.accountLabel}</small></td><td className="align-right"><strong>{item.cashChange >= 0 ? "+" : "−"}{formatCurrency(item.amount)}</strong></td></tr>)}</tbody></table></div>
      </> : null}
    </div>
  </Modal>;
}

function sum(parsed: KasParseResult | undefined, direction: "income" | "expense") {
  return parsed?.transactions.filter((item) => item.direction === direction).reduce((total, item) => total + item.amount, 0) || 0;
}
