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
  findSupplierInvoiceDuplicate,
  getSupplierAccount,
  inferSupplierAccount,
  supplierInvoiceDuplicateKey,
  SUPPLIER_BOOKKEEPING_ACCOUNTS,
} from "@/lib/document-control";
import {
  detectDocumentType,
  parseSupplierInvoice,
  parseZReport,
  type ParsedInvoice,
  type ParsedZReport,
} from "@/lib/document-parser";
import { readPdfForOcr } from "@/lib/pdf-reader";
import { useKassenStore } from "@/lib/store";
import type { BusinessDocument, LedgerEntry, PaymentMethod } from "@/lib/types";
import { Icon } from "../Icon";
import { Badge, Button, Card, Field, Input, PageHeader, Select } from "../ui";

type Parsed = ParsedZReport | ParsedInvoice;

const MAX_SCAN_BYTES = 20 * 1024 * 1024;
const MAX_INLINE_ARCHIVE_BYTES = 3 * 1024 * 1024;

export function ScannerPage() {
  const { state, replaceState, addScannedZReport } = useKassenStore();
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [ocrText, setOcrText] = useState("");
  const [parsed, setParsed] = useState<Parsed>();
  const [bookSales, setBookSales] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("bank");
  const [accountCode, setAccountCode] = useState("4980");
  const [invoicePaid, setInvoicePaid] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pdfInfo, setPdfInfo] = useState("");

  const isProcessing = status === "processing";
  const isPdf = Boolean(
    file && (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")),
  );
  const differenceWarning =
    parsed?.type === "zReport" && parsed.difference && parsed.difference !== 0;

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function chooseFile(selected?: File) {
    if (!selected) return;
    const pdf =
      selected.type === "application/pdf" || selected.name.toLowerCase().endsWith(".pdf");
    const image = selected.type.startsWith("image/");
    if (!pdf && !image) {
      setError("Bitte eine PDF-, JPG-, PNG- oder WEBP-Datei auswählen.");
      return;
    }
    if (selected.size > MAX_SCAN_BYTES) {
      setError("Die Datei ist größer als 20 MB. Bitte die PDF verkleinern oder teilen.");
      return;
    }

    setError("");
    setFile(selected);
    setPreview(URL.createObjectURL(selected));
    setParsed(undefined);
    setOcrText("");
    setMessage("");
    setPdfInfo("");
    setProgress(0);
  }

  async function recognizeSources(sources: Array<File | Blob>) {
    const { createWorker } = await import("tesseract.js");
    let activePage = 0;
    const totalPages = Math.max(sources.length, 1);
    const worker = await createWorker("deu", 1, {
      logger: (event) => {
        if (event.status === "recognizing text") {
          const totalProgress = (activePage + (event.progress || 0)) / totalPages;
          setProgress(Math.round(totalProgress * 100));
        }
      },
    });

    try {
      const parts: string[] = [];
      for (let index = 0; index < sources.length; index += 1) {
        activePage = index;
        const result = await worker.recognize(sources[index]);
        if (result.data.text.trim()) parts.push(result.data.text.trim());
      }
      return parts.join("\n");
    } finally {
      await worker.terminate();
    }
  }

  async function scan() {
    if (!file) return;
    setError("");
    setStatus("processing");
    setProgress(0);
    setPdfInfo("");

    try {
      let text = "";
      if (isPdf) {
        const pdf = await readPdfForOcr(file);
        if (pdf.pageImages.length > 0) {
          const recognized = await recognizeSources(pdf.pageImages);
          text = [pdf.embeddedText, recognized].filter(Boolean).join("\n");
          setPdfInfo(
            `${pdf.processedPages} von ${pdf.pageCount} PDF-Seiten wurden als Bild erkannt.`,
          );
        } else {
          text = pdf.embeddedText;
          setProgress(100);
          setPdfInfo(
            `${pdf.processedPages} von ${pdf.pageCount} PDF-Seiten wurden direkt ausgelesen.`,
          );
        }
      } else {
        text = await recognizeSources([file]);
      }

      if (!text.trim()) {
        throw new Error("In diesem Dokument konnte kein lesbarer Text erkannt werden.");
      }

      setOcrText(text);
      const type = detectDocumentType(text);
      if (type === "zReport") {
        setParsed(parseZReport(text));
      } else {
        const invoice = parseSupplierInvoice(text);
        setParsed(invoice);
        setAccountCode(inferSupplierAccount(invoice.vendor || "", text).code);
      }
      setStatus("done");
      setProgress(100);
    } catch (cause) {
      setStatus("");
      setError(cause instanceof Error ? cause.message : "OCR konnte nicht ausgeführt werden.");
    }
  }

  function updateField(key: string, value: string) {
    setParsed((current) =>
      current
        ? ({
            ...current,
            [key]: numericFields.has(key) ? Number(value.replace(",", ".")) || 0 : value,
          } as Parsed)
        : current,
    );
  }

  async function originalFileDataUrl() {
    if (!file || file.size > MAX_INLINE_ARCHIVE_BYTES) return undefined;
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function saveSupplierInvoice(invoice: ParsedInvoice, dataUrl?: string) {
    const date = invoice.date || todayIso();
    const vendor = invoice.vendor?.trim() || "Unbekannter Lieferant";
    const gross = invoice.gross || 0;
    if (gross <= 0) throw new Error("Bitte den Rechnungsbetrag prüfen.");

    const duplicate = findSupplierInvoiceDuplicate(state.documents, {
      vendor,
      date,
      gross,
      invoiceNumber: invoice.invoiceNumber,
      fileName: file?.name,
    });
    if (duplicate) {
      throw new Error(
        `Diese Rechnung ist bereits als ${duplicate.documentNumber} gespeichert. Bitte die vorhandene Rechnung öffnen oder zuerst löschen.`,
      );
    }

    const createdAt = new Date().toISOString();
    const documentId = makeId("document");
    const documentNumber =
      invoice.invoiceNumber?.trim() ||
      nextSequence(
        "ER",
        state.documents.map((document) => document.documentNumber),
        new Date(`${date}T12:00:00`),
      );
    const taxAmount = invoice.vat ?? getTaxAmountFromGross(gross);
    const account = getSupplierAccount(accountCode);
    const duplicateKey = supplierInvoiceDuplicateKey({
      vendor,
      date,
      gross,
      invoiceNumber: invoice.invoiceNumber,
      fileName: file?.name,
    });

    const document: BusinessDocument = {
      id: documentId,
      documentNumber,
      type: "supplierInvoice",
      date,
      amount: gross,
      taxAmount,
      taxMode: taxAmount > 0 ? "standard19" : "taxFree",
      paymentMethod,
      status: invoicePaid ? "paid" : "open",
      originalFileName: file?.name,
      originalImageDataUrl: dataUrl,
      ocrText,
      metadata: {
        vendor,
        invoiceNumber: invoice.invoiceNumber || null,
        accountCode: account.code,
        accountLabel: account.label,
        duplicateKey,
        automaticallyBooked: true,
      },
      createdAt,
    };

    const paymentAccount = {
      cash: "1000",
      card: "1360",
      bank: "1200",
      paypal: "1370",
    }[paymentMethod];

    const ledgerEntry: LedgerEntry = {
      id: makeId("ledger"),
      date,
      direction: "expense",
      amount: gross,
      paymentMethod,
      description: `Eingangsrechnung ${vendor}`,
      category: `${account.code} · ${account.label}`,
      source: "scan",
      sourceId: documentId,
      documentId,
      taxAmount,
      taxRate: taxAmount > 0 ? 19 : 0,
      taxMode: taxAmount > 0 ? "standard19" : "taxFree",
      reconciled: invoicePaid && (paymentMethod === "cash" || paymentMethod === "card"),
      accountCode: account.code,
      counterAccountCode: paymentAccount,
      documentNumber,
      cashChange: paymentMethod === "cash" && invoicePaid ? -gross : 0,
      netAmount: Math.round((gross - taxAmount) * 100) / 100,
      attachmentFileName: file?.name,
      attachmentDataUrl: dataUrl,
      createdAt,
    };

    replaceState({
      ...state,
      documents: [document, ...state.documents],
      ledger: [ledgerEntry, ...state.ledger],
    });
  }

  async function save() {
    if (!parsed) return;
    setError("");
    try {
      const dataUrl = await originalFileDataUrl();
      const archiveNote =
        file && file.size > MAX_INLINE_ARCHIVE_BYTES
          ? " Die Originaldatei ist für den lokalen Demo-Speicher zu groß; Dateiname und OCR-Text wurden gespeichert."
          : "";

      if (parsed.type === "zReport") {
        addScannedZReport({
          date: parsed.date || todayIso(),
          zNumber: parsed.zNumber,
          gross: parsed.gross || 0,
          net: parsed.net,
          vat: parsed.vat,
          cash: parsed.cash || 0,
          card: parsed.card || 0,
          salesCount: parsed.salesCount,
          difference: parsed.difference,
          imageDataUrl: dataUrl,
          fileName: file?.name,
          ocrText,
          bookSales,
        });
        setMessage(
          (bookSales
            ? "Tagesabschluss archiviert und Umsatz gebucht."
            : "Tagesabschluss archiviert und nur zum Abgleich gespeichert.") + archiveNote,
        );
      } else {
        await saveSupplierInvoice(parsed, dataUrl);
        const account = getSupplierAccount(accountCode);
        setMessage(
          `Eingangsrechnung gespeichert und automatisch auf ${account.code} ${account.label} in die Buchhaltung übernommen.` +
            archiveNote,
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Dokument konnte nicht gespeichert werden.");
    }
  }

  return <div>
    <PageHeader
      title="Beleg scannen"
      subtitle="PDF oder Foto hochladen, lokal auslesen, kontrollieren und automatisch in die Buchhaltung übernehmen."
    />
    {error ? <div className="alert alert-danger">{error}</div> : null}
    {message ? <div className="alert alert-success">{message}</div> : null}
    {pdfInfo ? <div className="alert alert-success">{pdfInfo}</div> : null}
    <div className="scanner-grid">
      <Card>
        <label className="dropzone">
          <input
            type="file"
            accept="application/pdf,.pdf,image/*"
            onChange={(event) => chooseFile(event.target.files?.[0])}
          />
          <span className="dropzone-icon"><Icon name="scan" width={32} height={32} /></span>
          <strong>{file ? file.name : "PDF, Belegfoto oder Bild auswählen"}</strong>
          <small>PDF, JPG, PNG oder WEBP · bis 20 MB · Verarbeitung lokal im Browser</small>
        </label>
        {preview ? (
          <div className="scan-preview">
            {isPdf ? (
              <object data={preview} type="application/pdf" className="pdf-preview">
                <a href={preview} target="_blank" rel="noreferrer">PDF öffnen</a>
              </object>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Belegvorschau" />
            )}
          </div>
        ) : null}
        <Button className="full-button" disabled={!file || isProcessing} onClick={() => void scan()}>
          {isProcessing ? `Dokument wird gelesen ${progress}%` : "Beleg jetzt auslesen"}
        </Button>
        {isProcessing ? <div className="progress"><span style={{ width: `${progress}%` }} /></div> : null}
      </Card>
      <Card>
        <div className="card-heading">
          <div><h2>Erkannte Daten</h2><p>Vor dem Speichern kannst du jedes Feld korrigieren.</p></div>
          {parsed ? <Badge tone="success">{parsed.type === "zReport" ? "Tagesabschluss" : "Eingangsrechnung"}</Badge> : null}
        </div>
        {!parsed ? (
          <div className="scanner-placeholder">
            <Icon name="documents" width={34} height={34} />
            <p>Nach der Texterkennung erscheinen hier Datum, Beträge und Belegnummer.</p>
          </div>
        ) : parsed.type === "zReport" ? (
          <ZReportForm
            parsed={parsed}
            updateField={updateField}
            bookSales={bookSales}
            setBookSales={setBookSales}
          />
        ) : (
          <InvoiceForm
            parsed={parsed}
            updateField={updateField}
            paymentMethod={paymentMethod}
            setPaymentMethod={setPaymentMethod}
            accountCode={accountCode}
            setAccountCode={setAccountCode}
            invoicePaid={invoicePaid}
            setInvoicePaid={setInvoicePaid}
          />
        )}
        {differenceWarning ? (
          <div className="alert alert-danger">
            Kassenabweichung erkannt: {formatCurrency(Number(parsed.difference))}. Bitte vor der Übernahme prüfen.
          </div>
        ) : null}
        {parsed ? <Button className="full-button" onClick={() => void save()}>Geprüfte Daten übernehmen</Button> : null}
      </Card>
    </div>
    {ocrText ? (
      <Card><details><summary>OCR-Rohtext anzeigen</summary><pre className="ocr-text">{ocrText}</pre></details></Card>
    ) : null}
  </div>;
}

const numericFields = new Set([
  "gross",
  "net",
  "vat",
  "cash",
  "card",
  "salesCount",
  "openingCash",
  "expectedCash",
  "countedCash",
  "difference",
]);

function ZReportForm({
  parsed,
  updateField,
  bookSales,
  setBookSales,
}: {
  parsed: ParsedZReport;
  updateField: (key: string, value: string) => void;
  bookSales: boolean;
  setBookSales: (value: boolean) => void;
}) {
  return <div className="form-stack">
    <div className="form-grid two">
      <Field label="Datum"><Input type="date" value={parsed.date || todayIso()} onChange={(event) => updateField("date", event.target.value)} /></Field>
      <Field label="Z-Bericht Nr."><Input value={parsed.zNumber || ""} onChange={(event) => updateField("zNumber", event.target.value)} /></Field>
      <MoneyField label="Brutto" value={parsed.gross} name="gross" update={updateField} />
      <MoneyField label="Netto" value={parsed.net} name="net" update={updateField} />
      <MoneyField label="MwSt." value={parsed.vat} name="vat" update={updateField} />
      <MoneyField label="Bar" value={parsed.cash} name="cash" update={updateField} />
      <MoneyField label="Karte" value={parsed.card} name="card" update={updateField} />
      <MoneyField label="Differenz" value={parsed.difference} name="difference" update={updateField} />
    </div>
    <label className="check-card">
      <input type="checkbox" checked={bookSales} onChange={(event) => setBookSales(event.target.checked)} />
      <span><strong>Tagesumsatz buchen</strong><small>Nur aktivieren, wenn diese Verkäufe nicht bereits einzeln im System erfasst wurden.</small></span>
    </label>
  </div>;
}

function InvoiceForm({
  parsed,
  updateField,
  paymentMethod,
  setPaymentMethod,
  accountCode,
  setAccountCode,
  invoicePaid,
  setInvoicePaid,
}: {
  parsed: ParsedInvoice;
  updateField: (key: string, value: string) => void;
  paymentMethod: PaymentMethod;
  setPaymentMethod: (value: PaymentMethod) => void;
  accountCode: string;
  setAccountCode: (value: string) => void;
  invoicePaid: boolean;
  setInvoicePaid: (value: boolean) => void;
}) {
  return <div className="form-stack">
    <div className="alert alert-info">
      Diese Rechnung wird beim Speichern automatisch als Ausgabe in die Buchhaltung eingetragen. Doppelte Rechnungen werden blockiert.
    </div>
    <div className="form-grid two">
      <Field label="Firma"><Input value={parsed.vendor || ""} onChange={(event) => updateField("vendor", event.target.value)} /></Field>
      <Field label="Rechnungsnummer"><Input value={parsed.invoiceNumber || ""} onChange={(event) => updateField("invoiceNumber", event.target.value)} /></Field>
      <Field label="Datum"><Input type="date" value={parsed.date || todayIso()} onChange={(event) => updateField("date", event.target.value)} /></Field>
      <Field label="Zahlungsart">
        <Select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>
          <option value="bank">Bank</option>
          <option value="paypal">PayPal</option>
          <option value="cash">Bar</option>
          <option value="card">Karte</option>
        </Select>
      </Field>
      <Field label="Buchungskonto">
        <Select value={accountCode} onChange={(event) => setAccountCode(event.target.value)}>
          {SUPPLIER_BOOKKEEPING_ACCOUNTS.map((account) => (
            <option key={account.code} value={account.code}>{account.code} · {account.label}</option>
          ))}
        </Select>
      </Field>
      <Field label="Zahlungsstatus">
        <Select value={invoicePaid ? "paid" : "open"} onChange={(event) => setInvoicePaid(event.target.value === "paid")}>
          <option value="paid">Bezahlt</option>
          <option value="open">Offen</option>
        </Select>
      </Field>
      <MoneyField label="Brutto" value={parsed.gross} name="gross" update={updateField} />
      <MoneyField label="MwSt." value={parsed.vat} name="vat" update={updateField} />
    </div>
  </div>;
}

function MoneyField({
  label,
  value,
  name,
  update,
}: {
  label: string;
  value?: number;
  name: string;
  update: (key: string, value: string) => void;
}) {
  return <Field label={label}>
    <Input type="number" step="0.01" value={value ?? ""} onChange={(event) => update(name, event.target.value)} />
  </Field>;
}
