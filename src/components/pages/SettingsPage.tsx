"use client";

import { useRef, useState } from "react";
import { useKassenStore } from "@/lib/store";
import type { AppState, BusinessSettings } from "@/lib/types";
import { Button, Card, Field, Input, PageHeader, Select } from "../ui";
import { KasBackupImportModal } from "./KasEntryReviewModal";

export function SettingsPage() {
  const { state, updateSettings, resetDemo, replaceState } = useKassenStore();
  const [draft, setDraft] = useState<BusinessSettings>(state.settings);
  const [message, setMessage] = useState("");
  const [kasOpen, setKasOpen] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);

  function set<K extends keyof BusinessSettings>(key: K, value: BusinessSettings[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function save() {
    updateSettings(draft);
    setMessage("Einstellungen gespeichert.");
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

  return <div>
    <PageHeader title="Einstellungen" subtitle="Firmendaten, Nummernkreise, Sprache und lokale Datensicherung." actions={<Button onClick={save}>Einstellungen speichern</Button>} />
    {message ? <div className="alert alert-success">{message}</div> : null}
    <div className="settings-grid">
      <Card><div className="card-heading"><div><h2>Firmendaten</h2><p>Diese Angaben erscheinen auf Rechnungen und Verträgen.</p></div></div><div className="form-grid two"><Field label="Firmenname"><Input value={draft.businessName} onChange={(e) => set("businessName", e.target.value)} /></Field><Field label="Inhaber"><Input value={draft.ownerName} onChange={(e) => set("ownerName", e.target.value)} /></Field><Field label="Straße"><Input value={draft.street} onChange={(e) => set("street", e.target.value)} /></Field><Field label="PLZ"><Input value={draft.postalCode} onChange={(e) => set("postalCode", e.target.value)} /></Field><Field label="Ort"><Input value={draft.city} onChange={(e) => set("city", e.target.value)} /></Field><Field label="Telefon"><Input value={draft.phone} onChange={(e) => set("phone", e.target.value)} /></Field><Field label="E-Mail"><Input type="email" value={draft.email} onChange={(e) => set("email", e.target.value)} /></Field><Field label="Steuernummer"><Input value={draft.taxNumber} onChange={(e) => set("taxNumber", e.target.value)} /></Field><Field label="USt-IdNr."><Input value={draft.vatId} onChange={(e) => set("vatId", e.target.value)} /></Field><Field label="IBAN"><Input value={draft.iban} onChange={(e) => set("iban", e.target.value)} /></Field></div></Card>
      <Card><div className="card-heading"><div><h2>Programm</h2><p>Nummernkreise und Grundeinstellungen.</p></div></div><div className="form-grid two"><Field label="Rechnung Präfix"><Input value={draft.invoicePrefix} onChange={(e) => set("invoicePrefix", e.target.value.toUpperCase())} /></Field><Field label="Quittung Präfix"><Input value={draft.receiptPrefix} onChange={(e) => set("receiptPrefix", e.target.value.toUpperCase())} /></Field><Field label="Ankauf Präfix"><Input value={draft.purchasePrefix} onChange={(e) => set("purchasePrefix", e.target.value.toUpperCase())} /></Field><Field label="Startbestand Kasse"><Input type="number" step="0.01" value={draft.openingCash} onChange={(e) => set("openingCash", Number(e.target.value) || 0)} /></Field><Field label="Sprache"><Select value={draft.language} onChange={(e) => set("language", e.target.value as BusinessSettings["language"])}><option value="de">Deutsch</option><option value="tr">Türkçe</option><option value="en">English</option></Select></Field></div></Card>
      <Card><div className="card-heading"><div><h2>Datensicherung</h2><p>Die aktuelle Version speichert Daten lokal im Browser. Exportiere regelmäßig eine Sicherung.</p></div></div><div className="backup-actions"><Button variant="secondary" icon="download" onClick={exportData}>JSON-Sicherung herunterladen</Button><Button variant="secondary" icon="upload" onClick={() => importInput.current?.click()}>JSON-Sicherung einlesen</Button><Button variant="secondary" icon="upload" onClick={() => setKasOpen(true)}>KAS-Backup einlesen</Button><input ref={importInput} type="file" accept="application/json,.json" hidden onChange={(event) => void importData(event.target.files?.[0])} /></div><div className="alert alert-info">Der KAS-Import zeigt vor dem Speichern Zeitraum, Konten, Summen und Dubletten an. Bestehende Daten werden nicht gelöscht.</div><div className="alert alert-warning">Für die spätere SaaS-Version wird dieser lokale Speicher durch PostgreSQL, verschlüsselte Dokumentablage, Benutzerrechte und automatische Backups ersetzt.</div></Card>
      <Card><div className="card-heading"><div><h2>Demo zurücksetzen</h2><p>Entfernt lokale Änderungen und lädt die Beispielstruktur neu.</p></div></div><Button variant="danger" onClick={() => { if (window.confirm("Lokale Daten wirklich zurücksetzen?")) { resetDemo(); setDraft(state.settings); setMessage("Demo wurde zurückgesetzt."); } }}>Lokale Demo zurücksetzen</Button></Card>
    </div>
    <KasBackupImportModal open={kasOpen} onClose={() => setKasOpen(false)} onImported={setMessage} />
  </div>;
}
