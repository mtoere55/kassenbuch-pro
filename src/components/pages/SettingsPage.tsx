"use client";

import { useEffect, useRef, useState } from "react";
import {
  bookkeepingRuleSummary,
  closeServiceAccess,
  loadRecordControl,
  saveRecordControl,
  updateServiceCode,
  useServiceAccess,
  type RecordControlConfig,
} from "@/lib/bookkeeping-rules";
import { useKassenStore } from "@/lib/store";
import type { AppState, BusinessSettings } from "@/lib/types";
import { Badge, Button, Card, Field, Input, PageHeader, Select } from "../ui";

export function SettingsPage() {
  const { state, updateSettings, resetDemo, replaceState } = useKassenStore();
  const { open: serviceOpen, config } = useServiceAccess();
  const [draft, setDraft] = useState<BusinessSettings>(state.settings);
  const [controlDraft, setControlDraft] = useState<RecordControlConfig>(() => loadRecordControl());
  const [message, setMessage] = useState("");
  const importInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // The external local configuration is intentionally synchronized here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setControlDraft(config);
  }, [config]);

  function set<K extends keyof BusinessSettings>(key: K, value: BusinessSettings[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function setControl<K extends keyof RecordControlConfig>(key: K, value: RecordControlConfig[K]) {
    setControlDraft((current) => ({ ...current, [key]: value }));
  }

  function save() {
    updateSettings(draft);
    setMessage("Einstellungen gespeichert.");
  }

  function saveControl() {
    const normalized: RecordControlConfig = {
      ...controlDraft,
      prefix: controlDraft.prefix.trim().toUpperCase() || "KB",
      startNumber: Math.max(1, Math.floor(controlDraft.startNumber || 700001)),
    };
    saveRecordControl(normalized);
    setControlDraft(normalized);
    setMessage("Fortlaufende Nummerierung und Änderungssperre wurden gespeichert.");
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `kassenbuch-pro-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importData(file?: File) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as AppState;
      if (!data.settings || !Array.isArray(data.ledger) || !Array.isArray(data.devices)) throw new Error("Ungültige Sicherungsdatei");
      replaceState(data);
      setDraft(data.settings);
      setMessage("Sicherung erfolgreich eingelesen.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import fehlgeschlagen.");
    }
  }

  const rules = bookkeepingRuleSummary();

  return <div>
    <PageHeader title="Einstellungen" subtitle="Firmendaten, Nummernkreise, Sprache und lokale Datensicherung." actions={<Button onClick={save}>Einstellungen speichern</Button>} />
    {message ? <div className="alert alert-success">{message}</div> : null}
    <div className="settings-grid">
      <Card><div className="card-heading"><div><h2>Firmendaten</h2><p>Diese Angaben erscheinen auf Rechnungen und Verträgen.</p></div></div><div className="form-grid two"><Field label="Firmenname"><Input value={draft.businessName} onChange={(e) => set("businessName", e.target.value)} /></Field><Field label="Inhaber"><Input value={draft.ownerName} onChange={(e) => set("ownerName", e.target.value)} /></Field><Field label="Straße"><Input value={draft.street} onChange={(e) => set("street", e.target.value)} /></Field><Field label="PLZ"><Input value={draft.postalCode} onChange={(e) => set("postalCode", e.target.value)} /></Field><Field label="Ort"><Input value={draft.city} onChange={(e) => set("city", e.target.value)} /></Field><Field label="Telefon"><Input value={draft.phone} onChange={(e) => set("phone", e.target.value)} /></Field><Field label="E-Mail"><Input type="email" value={draft.email} onChange={(e) => set("email", e.target.value)} /></Field><Field label="Steuernummer"><Input value={draft.taxNumber} onChange={(e) => set("taxNumber", e.target.value)} /></Field><Field label="USt-IdNr."><Input value={draft.vatId} onChange={(e) => set("vatId", e.target.value)} /></Field><Field label="IBAN"><Input value={draft.iban} onChange={(e) => set("iban", e.target.value)} /></Field></div></Card>
      <Card><div className="card-heading"><div><h2>Programm</h2><p>Nummernkreise und Grundeinstellungen.</p></div></div><div className="form-grid two"><Field label="Rechnung Präfix"><Input value={draft.invoicePrefix} onChange={(e) => set("invoicePrefix", e.target.value.toUpperCase())} /></Field><Field label="Quittung Präfix"><Input value={draft.receiptPrefix} onChange={(e) => set("receiptPrefix", e.target.value.toUpperCase())} /></Field><Field label="Ankauf Präfix"><Input value={draft.purchasePrefix} onChange={(e) => set("purchasePrefix", e.target.value.toUpperCase())} /></Field><Field label="Startbestand Kasse"><Input type="number" step="0.01" value={draft.openingCash} onChange={(e) => set("openingCash", Number(e.target.value) || 0)} /></Field><Field label="Sprache"><Select value={draft.language} onChange={(e) => set("language", e.target.value as BusinessSettings["language"])}><option value="de">Deutsch</option><option value="tr">Türkçe</option><option value="en">English</option></Select></Field></div></Card>
      <Card><div className="card-heading"><div><h2>Feste Buchungsregeln</h2><p>Diese Regeln werden bei Scanner, Bank-PDF und manuellen Prüfungen bevorzugt.</p></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Partner</th><th>Täglich / Einkauf</th><th>Monatsabrechnung</th></tr></thead><tbody>{rules.map((rule) => <tr key={rule.name}><td><strong>{rule.name}</strong></td><td>{rule.daily}</td><td>{rule.monthly}</td></tr>)}</tbody></table></div></Card>
      <Card><div className="card-heading"><div><h2>Datensicherung</h2><p>Die aktuelle Version speichert Daten lokal im Browser. Exportiere regelmäßig eine Sicherung.</p></div></div><div className="backup-actions"><Button variant="secondary" icon="download" onClick={exportData}>JSON-Sicherung herunterladen</Button><Button variant="secondary" icon="upload" onClick={() => importInput.current?.click()}>Sicherung einlesen</Button><input ref={importInput} type="file" accept="application/json,.json" hidden onChange={(event) => void importData(event.target.files?.[0])} /></div><div className="alert alert-warning">Für die spätere SaaS-Version wird dieser lokale Speicher durch PostgreSQL, verschlüsselte Dokumentablage, Benutzerrechte und automatische Backups ersetzt.</div></Card>
      {serviceOpen ? <Card><div className="card-heading"><div><h2>Servicebereich</h2><p>Fortlaufende interne Nachweisnummern und Sperre für den Echtbetrieb ab Juli.</p></div><Badge tone="warning">Service offen</Badge></div><div className="form-grid two"><Field label="Echtbetrieb ab"><Input type="date" value={controlDraft.startDate} onChange={(event) => setControl("startDate", event.target.value)} /></Field><Field label="Nachweis-Präfix"><Input value={controlDraft.prefix} onChange={(event) => setControl("prefix", event.target.value)} /></Field><Field label="Erste laufende Nummer"><Input type="number" step="1" value={controlDraft.startNumber} onChange={(event) => setControl("startNumber", Number(event.target.value) || 700001)} /></Field><Field label="Änderungssperre"><Select value={controlDraft.lockChanges ? "on" : "off"} onChange={(event) => setControl("lockChanges", event.target.value === "on")}><option value="on">Ab Startdatum gesperrt</option><option value="off">Vorübergehend nicht sperren</option></Select></Field></div><div className="backup-actions"><Button onClick={saveControl}>Serviceeinstellungen speichern</Button><Button variant="secondary" onClick={() => { if (updateServiceCode()) setMessage("Service-Code wurde geändert."); }}>Service-Code ändern</Button><Button variant="secondary" onClick={() => { closeServiceAccess(); setMessage("Servicezugang geschlossen."); }}>Servicezugang schließen</Button></div><div className="alert alert-info">Die Nachweisnummer ist eine interne fortlaufende Programmnummer. Sie ersetzt keine TSE, DSFinV-K oder zertifizierte Kassenlösung. Der lokale Service-Code ist eine Bedienungssperre, keine serverseitige Sicherheitsgrenze.</div></Card> : null}
      {serviceOpen ? <Card><div className="card-heading"><div><h2>Lokale Testdaten zurücksetzen</h2><p>Nur im geöffneten Servicebereich sichtbar. Entfernt lokale Änderungen und lädt die Beispielstruktur neu.</p></div></div><Button variant="danger" onClick={() => { if (window.confirm("Lokale Daten wirklich zurücksetzen?")) { resetDemo(); setDraft(state.settings); setMessage("Lokale Testdaten wurden zurückgesetzt."); } }}>Lokale Testdaten zurücksetzen</Button></Card> : null}
    </div>
  </div>;
}
