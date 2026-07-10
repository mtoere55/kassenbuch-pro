"use client";

import { useMemo, useState } from "react";
import { formatCurrency, formatDate, getTaxAmountFromGross, makeId, nextSequence, todayIso } from "@/lib/accounting";
import { printDocumentView, DocumentView } from "../DocumentView";
import { useKassenStore } from "@/lib/store";
import type { BusinessDocument, LedgerEntry, PaymentMethod, RepairDocumentType, RepairOrder, RepairStatus } from "@/lib/types";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, StatCard } from "../ui";

interface RepairDraft {
  customerId: string;
  date: string;
  brand: string;
  model: string;
  imei: string;
  serialNumber: string;
  passcode: string;
  accessories: string;
  issue: string;
  workDescription: string;
  price: string;
  paymentMethod: PaymentMethod;
  documentType: RepairDocumentType;
  notes: string;
}

export function RepairPage() {
  const { state, replaceState } = useKassenStore();
  const repairs = state.repairs ?? [];
  const [draft, setDraft] = useState<RepairDraft>(() => createDraft());
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [selectedDocumentId, setSelectedDocumentId] = useState<string>();
  const [statusFilter, setStatusFilter] = useState<"all" | RepairStatus>("all");
  const selectedDocument = state.documents.find((document) => document.id === selectedDocumentId);

  const filteredRepairs = useMemo(() => repairs.filter((repair) => statusFilter === "all" || repair.status === statusFilter), [repairs, statusFilter]);
  const openCount = repairs.filter((repair) => !["paid", "cancelled"].includes(repair.status)).length;
  const monthRevenue = state.ledger.filter((entry) => entry.source === "repair" && entry.date.slice(0, 7) === todayIso().slice(0, 7)).reduce((sum, entry) => sum + entry.amount, 0);

  function patch<K extends keyof RepairDraft>(key: K, value: RepairDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function createRepair() {
    setError("");
    const price = parseMoney(draft.price);
    if (!draft.brand.trim() || !draft.model.trim()) return setError("Bitte Marke und Modell eintragen.");
    if (!draft.issue.trim()) return setError("Bitte Fehlerbeschreibung / Kundenauftrag eintragen.");
    if (draft.documentType !== "estimate" && price <= 0) return setError("Für Rechnung oder Quittung bitte einen Betrag größer 0,00 € eintragen.");

    const createdAt = new Date().toISOString();
    const repairNumber = nextSequence("REP", repairs.map((repair) => repair.repairNumber), new Date(`${draft.date}T12:00:00`));
    const documentNumber = nextRepairDocumentNumber(draft.documentType, state.documents.map((document) => document.documentNumber), draft.date);
    const repairId = makeId("repair");
    const documentId = makeId("document");
    const taxAmount = draft.documentType === "estimate" ? 0 : getTaxAmountFromGross(price, 19);
    const customerId = draft.customerId || undefined;
    const metadata = {
      repairNumber,
      repairBrand: draft.brand.trim(),
      repairModel: draft.model.trim(),
      repairImei: draft.imei.trim() || null,
      repairSerialNumber: draft.serialNumber.trim() || null,
      repairPasscode: draft.passcode.trim() || null,
      repairAccessories: draft.accessories.trim() || null,
      repairIssue: draft.issue.trim(),
      repairWorkDescription: draft.workDescription.trim() || draft.issue.trim(),
      repairNotes: draft.notes.trim() || null,
      documentKind: draft.documentType,
    };
    const document: BusinessDocument = {
      id: documentId,
      documentNumber,
      type: draft.documentType === "estimate" ? "estimate" : draft.documentType,
      date: draft.date,
      customerId,
      repairId,
      amount: price,
      taxAmount,
      taxMode: draft.documentType === "estimate" ? "taxFree" : "standard19",
      paymentMethod: draft.documentType === "estimate" ? undefined : draft.paymentMethod,
      status: draft.documentType === "estimate" ? "open" : "paid",
      metadata,
      createdAt,
    };
    const ledgerId = draft.documentType === "estimate" ? undefined : makeId("ledger");
    const repair: RepairOrder = {
      id: repairId,
      repairNumber,
      customerId,
      date: draft.date,
      brand: draft.brand.trim(),
      model: draft.model.trim(),
      imei: draft.imei.trim() || undefined,
      serialNumber: draft.serialNumber.trim() || undefined,
      passcode: draft.passcode.trim() || undefined,
      accessories: draft.accessories.trim() || undefined,
      issue: draft.issue.trim(),
      workDescription: draft.workDescription.trim() || draft.issue.trim(),
      status: draft.documentType === "estimate" ? "estimate" : "paid",
      price,
      costEstimate: draft.documentType === "estimate" ? price : undefined,
      paymentMethod: draft.paymentMethod,
      documentType: draft.documentType,
      documentId,
      ledgerEntryId: ledgerId,
      notes: draft.notes.trim() || undefined,
      createdAt,
    };
    const ledgerEntry: LedgerEntry | undefined = ledgerId ? {
      id: ledgerId,
      date: draft.date,
      direction: "income",
      amount: price,
      paymentMethod: draft.paymentMethod,
      description: `Reparatur ${repair.brand} ${repair.model}`,
      category: "8402 · Erloese 19 Prozent / Reparatur Service",
      source: "repair",
      sourceId: repairId,
      documentId,
      customerId,
      taxAmount,
      taxRate: 19,
      taxMode: "standard19",
      reconciled: true,
      accountCode: "8402",
      counterAccountCode: paymentAccount(draft.paymentMethod),
      documentNumber,
      cashChange: draft.paymentMethod === "cash" ? price : 0,
      netAmount: roundMoney(price - taxAmount),
      note: repairNumber,
      createdAt,
    } : undefined;

    replaceState({
      ...state,
      repairs: [repair, ...repairs],
      documents: [document, ...state.documents],
      ledger: ledgerEntry ? [ledgerEntry, ...state.ledger] : state.ledger,
      customers: state.customers.map((customer) => customer.id === customerId && !customer.roles.includes("repair") ? { ...customer, roles: [...customer.roles, "repair"] } : customer),
    });
    setDraft(createDraft());
    setSelectedDocumentId(documentId);
    setNotice(`${repairNumber} wurde erstellt. ${draft.documentType === "estimate" ? "Kostenvoranschlag ohne Kassenbuch-Buchung." : `${documentNumber} wurde ins Kassenbuch übernommen.`}`);
  }

  return <div>
    <PageHeader title="Reparatur / Service" subtitle="Kundengeräte erfassen, Kostenvoranschlag, Rechnung oder Quittung erstellen und bezahlte Reparaturen automatisch ins Kassenbuch buchen." />
    {notice ? <div className="alert alert-success">{notice}</div> : null}
    {error ? <div className="alert alert-danger">{error}</div> : null}
    <div className="stat-grid compact"><StatCard label="Offene Reparaturen" value={String(openCount)} /><StatCard label="Abgeschlossen" value={String(repairs.filter((repair) => repair.status === "paid").length)} tone="positive" /><StatCard label="Monat Reparaturumsatz" value={formatCurrency(monthRevenue)} tone="blue" /></div>
    <div className="grid two-col">
      <Card>
        <div className="card-heading"><div><h2>Neue Reparatur / Service</h2><p>Auch ohne Warenbestand: Kundenhandy annehmen, Zustand notieren und direkt Dokument erstellen.</p></div></div>
        <div className="form-grid two">
          <Field label="Kunde"><Select value={draft.customerId} onChange={(event) => patch("customerId", event.target.value)}><option value="">Laufkundschaft / ohne Kundendaten</option>{state.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.company || `${customer.firstName} ${customer.lastName}`} · {customer.customerNumber}</option>)}</Select></Field>
          <Field label="Datum"><Input type="date" value={draft.date} onChange={(event) => patch("date", event.target.value)} /></Field>
          <Field label="Marke"><Input value={draft.brand} onChange={(event) => patch("brand", event.target.value)} placeholder="z.B. Samsung" /></Field>
          <Field label="Modell"><Input value={draft.model} onChange={(event) => patch("model", event.target.value)} placeholder="z.B. iPhone 13" /></Field>
          <Field label="IMEI"><Input value={draft.imei} onChange={(event) => patch("imei", event.target.value)} /></Field>
          <Field label="Seriennummer"><Input value={draft.serialNumber} onChange={(event) => patch("serialNumber", event.target.value)} /></Field>
          <Field label="Code / Sperre"><Input value={draft.passcode} onChange={(event) => patch("passcode", event.target.value)} placeholder="optional" /></Field>
          <Field label="Zubehör"><Input value={draft.accessories} onChange={(event) => patch("accessories", event.target.value)} placeholder="SIM, Hülle, Ladegerät..." /></Field>
        </div>
        <div className="form-stack booking-details"><Field label="Fehlerbeschreibung / Kundenauftrag"><textarea className="input textarea" value={draft.issue} onChange={(event) => patch("issue", event.target.value)} placeholder="Display defekt, lädt nicht, Wasserschaden..." /></Field><Field label="Leistung / Reparaturtext"><textarea className="input textarea" value={draft.workDescription} onChange={(event) => patch("workDescription", event.target.value)} placeholder="Displaytausch inkl. Ersatzteil und Arbeit" /></Field></div>
        <div className="form-grid two booking-details"><Field label="Dokument"><Select value={draft.documentType} onChange={(event) => patch("documentType", event.target.value as RepairDocumentType)}><option value="estimate">Kostenvoranschlag</option><option value="invoice">Rechnung</option><option value="receipt">Quittung</option></Select></Field><Field label="Zahlungsart"><Select value={draft.paymentMethod} onChange={(event) => patch("paymentMethod", event.target.value as PaymentMethod)} disabled={draft.documentType === "estimate"}><option value="cash">Bar / Kasse</option><option value="card">Karte</option><option value="bank">Bank</option><option value="paypal">PayPal</option></Select></Field><Field label="Preis brutto"><Input inputMode="decimal" value={draft.price} onChange={(event) => patch("price", event.target.value)} placeholder="0,00" /></Field><Field label="Notiz intern"><Input value={draft.notes} onChange={(event) => patch("notes", event.target.value)} /></Field></div>
        <div className="calculation-box"><h3>Automatik</h3><div><span>Konto</span><strong>8402 · Reparatur Service 19%</strong></div><div><span>Kassenbuch</span><strong>{draft.documentType === "estimate" ? "Nein, erst bei Rechnung/Quittung" : "Ja, automatisch mit Dokument Nr."}</strong></div></div>
        <Button onClick={createRepair}>{draft.documentType === "estimate" ? "Kostenvoranschlag erstellen" : "Reparatur buchen"}</Button>
      </Card>
      <Card>
        <div className="card-heading"><div><h2>Reparaturübersicht</h2><p>Alle Kundengeräte und Serviceaufträge mit Nummer und Status.</p></div><Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">Alle Status</option><option value="estimate">Kostenvoranschlag</option><option value="approved">Freigegeben</option><option value="inRepair">In Reparatur</option><option value="done">Fertig</option><option value="paid">Bezahlt</option><option value="cancelled">Storniert</option></Select></div>
        {filteredRepairs.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Nr.</th><th>Gerät</th><th>Status</th><th>Betrag</th><th /></tr></thead><tbody>{filteredRepairs.map((repair) => <tr key={repair.id}><td><strong>{repair.repairNumber}</strong><small>{formatDate(repair.date)}</small></td><td><strong>{repair.brand} {repair.model}</strong><small>{repair.imei || repair.serialNumber || repair.issue}</small></td><td><Badge tone={repairTone(repair.status)}>{repairStatusLabel(repair.status)}</Badge></td><td>{formatCurrency(repair.price)}</td><td className="align-right"><Button variant="secondary" onClick={() => setSelectedDocumentId(repair.documentId)}>Dokument</Button></td></tr>)}</tbody></table></div> : <EmptyState icon="devices" title="Noch keine Reparaturen" text="Erstelle links den ersten Serviceauftrag." />}
      </Card>
    </div>
    {selectedDocument ? <Modal open title={`${documentTitle(selectedDocument.type)} ${selectedDocument.documentNumber}`} onClose={() => setSelectedDocumentId(undefined)} wide footer={<><Button variant="secondary" onClick={() => setSelectedDocumentId(undefined)}>Schließen</Button><Button icon="print" onClick={printDocumentView}>Drucken</Button></>}><DocumentView document={selectedDocument} /></Modal> : null}
  </div>;
}

function createDraft(): RepairDraft { return { customerId: "", date: todayIso(), brand: "", model: "", imei: "", serialNumber: "", passcode: "", accessories: "", issue: "", workDescription: "", price: "", paymentMethod: "cash", documentType: "estimate", notes: "" }; }
function nextRepairDocumentNumber(type: RepairDocumentType, existing: string[], date: string): string { const prefix = type === "estimate" ? "KV" : type === "invoice" ? "RE" : "QU"; return nextSequence(prefix, existing, new Date(`${date}T12:00:00`)); }
function parseMoney(value: string): number { const normalized = value.trim().replace(/\s/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", "."); const parsed = Number(normalized); return Number.isFinite(parsed) ? parsed : 0; }
function roundMoney(value: number): number { return Math.round((value + Number.EPSILON) * 100) / 100; }
function paymentAccount(method: PaymentMethod): string { return ({ cash: "1000", card: "1360", bank: "1200", paypal: "1370" } as const)[method]; }
function repairStatusLabel(status: RepairStatus): string { return ({ intake: "Annahme", estimate: "Kostenvoranschlag", approved: "Freigegeben", inRepair: "In Reparatur", done: "Fertig", paid: "Bezahlt", cancelled: "Storniert" } as const)[status]; }
function repairTone(status: RepairStatus): "neutral" | "success" | "warning" | "danger" | "info" { return status === "paid" ? "success" : status === "cancelled" ? "danger" : status === "done" ? "info" : "warning"; }
function documentTitle(type: BusinessDocument["type"]): string { return type === "estimate" ? "Kostenvoranschlag" : type === "invoice" ? "Rechnung" : type === "receipt" ? "Quittung" : "Dokument"; }
