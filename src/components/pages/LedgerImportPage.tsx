"use client";

import { useEffect, useState } from "react";
import {
  formatCurrency,
  getTaxAmountFromGross,
  makeId,
  nextSequence,
  todayIso,
} from "@/lib/accounting";
import {
  loadRecordControl,
  officialRecordNumber,
  useServiceAccess,
} from "@/lib/bookkeeping-rules";
import { migrateKasImportSources } from "@/lib/kas-review";
import { useKassenStore } from "@/lib/store";
import type { BusinessDocument, LedgerEntry, PaymentMethod } from "@/lib/types";
import { DocumentView } from "../DocumentView";
import { Badge, Button, Card, Modal } from "../ui";
import { KasImportModal } from "./KasImportModal";
import { LedgerPage } from "./LedgerPage";

export function LedgerImportPage() {
  const { state, replaceState } = useKassenStore();
  const { open: serviceOpen } = useServiceAccess();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<BusinessDocument>();
  const config = loadRecordControl();
  const official = state.ledger
    .filter((entry) => entry.date >= config.startDate && officialRecordNumber(entry))
    .sort((left, right) => `${right.date}|${right.createdAt}`.localeCompare(`${left.date}|${left.createdAt}`))
    .slice(0, 5);

  useEffect(() => {
    const migrated = migrateKasImportSources(state);
    if (migrated !== state) replaceState(migrated);
  }, [replaceState, state]);

  function addSpecial(accountCode: string, label: string, taxRate: 0 | 19) {
    const rawAmount = window.prompt(`${label}\nBetrag in Euro:`, "0,00");
    if (!rawAmount) return;
    const amount = Number(rawAmount.replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      setNotice("Ungültiger Betrag.");
      return;
    }
    const date = window.prompt("Buchungsdatum (JJJJ-MM-TT):", todayIso()) || todayIso();
    const methodRaw = (window.prompt("Zahlungsart: cash, card, bank oder paypal", "cash") || "cash").toLowerCase();
    const paymentMethod: PaymentMethod = ["cash", "card", "bank", "paypal"].includes(methodRaw)
      ? methodRaw as PaymentMethod
      : "cash";
    const taxAmount = taxRate ? getTaxAmountFromGross(amount, taxRate) : 0;
    const entry: LedgerEntry = {
      id: makeId("ledger"),
      date,
      direction: "income",
      amount,
      paymentMethod,
      description: label,
      category: `${accountCode} · ${label}`,
      source: "manual",
      sourceId: makeId("special"),
      taxAmount,
      taxRate,
      taxMode: taxRate ? "standard19" : "taxFree",
      reconciled: true,
      accountCode,
      counterAccountCode: paymentMethod === "cash" ? "1000" : paymentMethod === "card" ? "1360" : paymentMethod === "paypal" ? "1370" : "1200",
      cashChange: paymentMethod === "cash" ? amount : 0,
      netAmount: Math.round((amount - taxAmount) * 100) / 100,
      note: accountCode === "1590" || accountCode === "1591"
        ? "Verrechnung ohne erneute Tagesumsatzsteuer; Monatsabrechnung separat buchen"
        : "Monatliche Provision mit 19 Prozent",
      manualKind: "income",
      createdAt: new Date().toISOString(),
    };
    replaceState({ ...state, ledger: [entry, ...state.ledger] });
    setNotice(`${label} wurde mit ${formatCurrency(amount)} gebucht.`);
  }

  function createDocumentFromEntry() {
    const candidates = state.ledger
      .filter((entry) => entry.direction === "income" && !entry.documentId)
      .sort((left, right) => `${right.date}|${right.createdAt}`.localeCompare(`${left.date}|${left.createdAt}`))
      .slice(0, 25);
    if (!candidates.length) {
      setNotice("Es gibt keine Einnahme ohne verknüpftes Dokument.");
      return;
    }
    const menu = candidates
      .map((entry, index) => `${index + 1}. ${entry.date} · ${formatCurrency(entry.amount)} · ${entry.description}`)
      .join("\n");
    const selected = Number(window.prompt(`Buchung auswählen:\n${menu}`, "1"));
    const entry = candidates[selected - 1];
    if (!entry) return;
    const typeInput = (window.prompt("Dokumentart: R für Rechnung, Q für Quittung", "Q") || "Q").toUpperCase();
    const type = typeInput === "R" ? "invoice" : "receipt";
    const prefix = type === "invoice" ? state.settings.invoicePrefix : state.settings.receiptPrefix;
    const documentNumber = nextSequence(prefix, state.documents.map((item) => item.documentNumber), new Date(`${entry.date}T12:00:00`));
    const document: BusinessDocument = {
      id: makeId("document"),
      documentNumber,
      type,
      date: entry.date,
      customerId: entry.customerId,
      amount: entry.amount,
      taxAmount: entry.taxAmount,
      taxMode: entry.taxMode,
      paymentMethod: entry.paymentMethod,
      status: "paid",
      metadata: {
        description: entry.description,
        sourceLedgerEntryId: entry.id,
        createdFromExistingBooking: true,
      },
      createdAt: new Date().toISOString(),
    };
    replaceState({
      ...state,
      documents: [document, ...state.documents],
      ledger: state.ledger.map((item) => item.id === entry.id
        ? { ...item, documentId: document.id, documentNumber }
        : item),
    });
    setPreview(document);
    setNotice(`${documentNumber} oluşturuldu; gelir ikinci kez kaydedilmedi.`);
  }

  return <>
    <div className="booking-shortcuts">
      <Button variant="secondary" onClick={() => setOpen(true)}>KAS-Backup importieren</Button>
      <Button variant="secondary" onClick={() => addSpecial("1590", "UniTel Guthaben-Verrechnung", 0)}>UniTel 0 %</Button>
      <Button variant="secondary" onClick={() => addSpecial("1591", "Prifoto Tagesumsatz-Verrechnung", 0)}>Prifoto 0 %</Button>
      <Button variant="secondary" onClick={() => addSpecial("8510", "Monatliche Provision", 19)}>Provision 19 %</Button>
      <Button onClick={createDocumentFromEntry}>Rechnung / Quittung aus Buchung</Button>
    </div>
    {notice ? <div className="alert alert-success">{notice}</div> : null}
    <div className="alert alert-info">Echtbetrieb ab {config.startDate}: fortlaufende Nachweisnummern beginnen mit {config.prefix}-{String(config.startNumber).padStart(6, "0")}. Servicezugang: {serviceOpen ? "offen" : "geschlossen"}.</div>
    {official.length ? <Card><div className="card-heading"><div><h2>Letzte Nachweisnummern</h2><p>Fortlaufende interne Programmkontrolle ab Juli.</p></div><Badge tone="info">{official.length} angezeigt</Badge></div><div className="detail-list">{official.map((entry) => <div key={entry.id}><dt>{officialRecordNumber(entry)}</dt><dd>{entry.date} · {entry.description} · {formatCurrency(entry.amount)}</dd></div>)}</div></Card> : null}
    <LedgerPage />
    <KasImportModal open={open} onClose={() => setOpen(false)} onImported={setNotice} />
    <Modal open={Boolean(preview)} onClose={() => setPreview(undefined)} title="Dokument erstellt" wide footer={<><Button variant="secondary" onClick={() => setPreview(undefined)}>Schließen</Button><Button onClick={() => window.print()}>Drucken</Button></>}>
      {preview ? <DocumentView document={preview} /> : null}
    </Modal>
  </>;
}
