"use client";

import { useState } from "react";
import { formatCurrency, todayIso } from "@/lib/accounting";
import { detectDocumentType, parseSupplierInvoice, parseZReport, type ParsedInvoice, type ParsedZReport } from "@/lib/document-parser";
import { useKassenStore } from "@/lib/store";
import type { PaymentMethod } from "@/lib/types";
import { Icon } from "../Icon";
import { Badge, Button, Card, Field, Input, PageHeader, Select } from "../ui";

type Parsed = ParsedZReport | ParsedInvoice;

export function ScannerPage() {
  const { addScannedZReport, addSupplierInvoice } = useKassenStore();
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [ocrText, setOcrText] = useState("");
  const [parsed, setParsed] = useState<Parsed>();
  const [bookSales, setBookSales] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("bank");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const isProcessing = status === "processing";
  const differenceWarning = parsed?.type === "zReport" && parsed.difference && parsed.difference !== 0;

  function chooseFile(selected?: File) {
    if (!selected) return;
    if (!selected.type.startsWith("image/")) {
      setError("Diese Version liest Bilddateien (JPG/PNG/WEBP). PDF-OCR folgt im nächsten Connector-Schritt.");
      return;
    }
    setError("");
    setFile(selected);
    setPreview(URL.createObjectURL(selected));
    setParsed(undefined);
    setOcrText("");
    setMessage("");
    setProgress(0);
  }

  async function scan() {
    if (!file) return;
    setError("");
    setStatus("processing");
    setProgress(0);
    try {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("deu", 1, {
        logger: (event) => {
          if (event.status === "recognizing text") setProgress(Math.round((event.progress || 0) * 100));
        },
      });
      const result = await worker.recognize(file);
      await worker.terminate();
      const text = result.data.text;
      setOcrText(text);
      const type = detectDocumentType(text);
      setParsed(type === "zReport" ? parseZReport(text) : parseSupplierInvoice(text));
      setStatus("done");
    } catch (cause) {
      setStatus("");
      setError(cause instanceof Error ? cause.message : "OCR konnte nicht ausgeführt werden.");
    }
  }

  function updateField(key: string, value: string) {
    setParsed((current) => current ? { ...current, [key]: numericFields.has(key) ? Number(value.replace(",", ".")) || 0 : value } as Parsed : current);
  }

  async function imageDataUrl() {
    if (!file) return undefined;
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function save() {
    if (!parsed) return;
    setError("");
    try {
      const dataUrl = await imageDataUrl();
      if (parsed.type === "zReport") {
        addScannedZReport({
          date: parsed.date || todayIso(), zNumber: parsed.zNumber, gross: parsed.gross || 0, net: parsed.net, vat: parsed.vat,
          cash: parsed.cash || 0, card: parsed.card || 0, salesCount: parsed.salesCount, difference: parsed.difference,
          imageDataUrl: dataUrl, fileName: file?.name, ocrText, bookSales,
        });
        setMessage(bookSales ? "Tagesabschluss archiviert und Umsatz gebucht." : "Tagesabschluss archiviert und nur zum Abgleich gespeichert.");
      } else {
        addSupplierInvoice({ date: parsed.date || todayIso(), vendor: parsed.vendor || "Unbekannter Lieferant", invoiceNumber: parsed.invoiceNumber, gross: parsed.gross || 0, vat: parsed.vat, paymentMethod, imageDataUrl: dataUrl, fileName: file?.name, ocrText });
        setMessage("Eingangsrechnung als Ausgabe gespeichert.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Dokument konnte nicht gespeichert werden.");
    }
  }

  return <div>
    <PageHeader title="Beleg scannen" subtitle="Foto hochladen, lokal im Browser auslesen, kontrollieren und mit einem Klick buchen." />
    {error ? <div className="alert alert-danger">{error}</div> : null}
    {message ? <div className="alert alert-success">{message}</div> : null}
    <div className="scanner-grid">
      <Card>
        <label className="dropzone"><input type="file" accept="image/*" capture="environment" onChange={(event) => chooseFile(event.target.files?.[0])} /><span className="dropzone-icon"><Icon name="scan" width={32} height={32} /></span><strong>{file ? file.name : "Beleg fotografieren oder Bild auswählen"}</strong><small>JPG, PNG oder WEBP · Bild bleibt in dieser lokalen Demo im Browser</small></label>
        {preview ? (
          <div className="scan-preview">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Belegvorschau" />
          </div>
        ) : null}
        <Button className="full-button" disabled={!file || isProcessing} onClick={() => void scan()}>{isProcessing ? `Texterkennung ${progress}%` : "Beleg jetzt auslesen"}</Button>
        {isProcessing ? <div className="progress"><span style={{ width: `${progress}%` }} /></div> : null}
      </Card>
      <Card>
        <div className="card-heading"><div><h2>Erkannte Daten</h2><p>Vor dem Speichern kannst du jedes Feld korrigieren.</p></div>{parsed ? <Badge tone="success">{parsed.type === "zReport" ? "Tagesabschluss" : "Eingangsrechnung"}</Badge> : null}</div>
        {!parsed ? <div className="scanner-placeholder"><Icon name="documents" width={34} height={34} /><p>Nach der Texterkennung erscheinen hier Datum, Beträge und Belegnummer.</p></div> : parsed.type === "zReport" ? <ZReportForm parsed={parsed} updateField={updateField} bookSales={bookSales} setBookSales={setBookSales} /> : <InvoiceForm parsed={parsed} updateField={updateField} paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod} />}
        {differenceWarning ? <div className="alert alert-danger">Kassenabweichung erkannt: {formatCurrency(Number(parsed.difference))}. Bitte vor der Übernahme prüfen.</div> : null}
        {parsed ? <Button className="full-button" onClick={() => void save()}>Geprüfte Daten übernehmen</Button> : null}
      </Card>
    </div>
    {ocrText ? <Card><details><summary>OCR-Rohtext anzeigen</summary><pre className="ocr-text">{ocrText}</pre></details></Card> : null}
  </div>;
}

const numericFields = new Set(["gross", "net", "vat", "cash", "card", "salesCount", "openingCash", "expectedCash", "countedCash", "difference"]);

function ZReportForm({ parsed, updateField, bookSales, setBookSales }: { parsed: ParsedZReport; updateField: (key: string, value: string) => void; bookSales: boolean; setBookSales: (value: boolean) => void }) {
  return <div className="form-stack"><div className="form-grid two"><Field label="Datum"><Input type="date" value={parsed.date || todayIso()} onChange={(event) => updateField("date", event.target.value)} /></Field><Field label="Z-Bericht Nr."><Input value={parsed.zNumber || ""} onChange={(event) => updateField("zNumber", event.target.value)} /></Field><MoneyField label="Brutto" value={parsed.gross} name="gross" update={updateField} /><MoneyField label="Netto" value={parsed.net} name="net" update={updateField} /><MoneyField label="MwSt." value={parsed.vat} name="vat" update={updateField} /><MoneyField label="Bar" value={parsed.cash} name="cash" update={updateField} /><MoneyField label="Karte" value={parsed.card} name="card" update={updateField} /><MoneyField label="Differenz" value={parsed.difference} name="difference" update={updateField} /></div><label className="check-card"><input type="checkbox" checked={bookSales} onChange={(event) => setBookSales(event.target.checked)} /><span><strong>Tagesumsatz buchen</strong><small>Nur aktivieren, wenn diese Verkäufe nicht bereits einzeln im System erfasst wurden.</small></span></label></div>;
}

function InvoiceForm({ parsed, updateField, paymentMethod, setPaymentMethod }: { parsed: ParsedInvoice; updateField: (key: string, value: string) => void; paymentMethod: PaymentMethod; setPaymentMethod: (value: PaymentMethod) => void }) {
  return <div className="form-grid two"><Field label="Firma"><Input value={parsed.vendor || ""} onChange={(event) => updateField("vendor", event.target.value)} /></Field><Field label="Rechnungsnummer"><Input value={parsed.invoiceNumber || ""} onChange={(event) => updateField("invoiceNumber", event.target.value)} /></Field><Field label="Datum"><Input type="date" value={parsed.date || todayIso()} onChange={(event) => updateField("date", event.target.value)} /></Field><Field label="Zahlungsart"><Select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}><option value="bank">Bank</option><option value="paypal">PayPal</option><option value="cash">Bar</option><option value="card">Karte</option></Select></Field><MoneyField label="Brutto" value={parsed.gross} name="gross" update={updateField} /><MoneyField label="MwSt." value={parsed.vat} name="vat" update={updateField} /></div>;
}

function MoneyField({ label, value, name, update }: { label: string; value?: number; name: string; update: (key: string, value: string) => void }) { return <Field label={label}><Input type="number" step="0.01" value={value ?? ""} onChange={(event) => update(name, event.target.value)} /></Field>; }
