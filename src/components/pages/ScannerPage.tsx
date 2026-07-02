"use client";

import { formatCurrency } from "@/lib/accounting";
import { Icon } from "../Icon";
import { Badge, Button, Card, Field, PageHeader, Select } from "../ui";
import { InvoiceFields, ZReportFields } from "./scanner/ReceiptForms";
import { type ScanDocumentType, useScannerController } from "./scanner/useScannerController";

export function ScannerPage() {
  const scan = useScannerController();
  return <div>
    <PageHeader title="Beleg scannen" subtitle="PDF oder Foto hochladen, lange Belege optimieren, kontrollieren und automatisch buchen." />
    {scan.error ? <div className="alert alert-danger">{scan.error}</div> : null}
    {scan.message ? <div className="alert alert-success">{scan.message}</div> : null}
    {scan.scanInfo ? <div className="alert alert-success">{scan.scanInfo}</div> : null}
    <div className="scanner-grid">
      <Card>
        <label className="dropzone">
          <input type="file" accept="application/pdf,.pdf,image/*" onChange={(event) => scan.chooseFile(event.target.files?.[0])} />
          <span className="dropzone-icon"><Icon name="scan" width={32} height={32} /></span>
          <strong>{scan.file ? scan.file.name : "PDF, Kassenbeleg oder Rechnung auswählen"}</strong>
          <small>PDF, JPG, PNG oder WEBP · bis 20 MB · lange Belege werden automatisch geteilt</small>
        </label>
        {scan.preview ? <div className="scan-preview">{scan.isPdf ? <object data={scan.preview} type="application/pdf" className="pdf-preview"><a href={scan.preview}>PDF öffnen</a></object> : <img src={scan.preview} alt="Belegvorschau" />}</div> : null}
        <Button className="full-button" disabled={!scan.file || scan.isProcessing} onClick={() => void scan.scan()}>{scan.isProcessing ? `Dokument wird gelesen ${scan.progress}%` : "Beleg jetzt auslesen"}</Button>
        {scan.isProcessing ? <div className="progress"><span style={{ width: `${scan.progress}%` }} /></div> : null}
      </Card>
      <Card>
        <div className="card-heading"><div><h2>Erkannte Daten</h2><p>Dokumenttyp und Werte können korrigiert werden.</p></div>{scan.parsed ? <Badge tone="success">{scan.parsed.type === "zReport" ? "Tagesabschluss" : "Eingangsrechnung"}</Badge> : null}</div>
        {scan.parsed ? <Field label="Dokumenttyp" hint="Bei falscher Erkennung manuell umstellen."><Select value={scan.parsed.type} onChange={(event) => scan.applyDocumentType(event.target.value as ScanDocumentType)}><option value="zReport">Tagesabschluss / Z-Bericht</option><option value="supplierInvoice">Eingangsrechnung / Beleg</option></Select></Field> : null}
        {scan.incompleteWarning ? <div className="alert alert-warning">{scan.incompleteWarning}</div> : null}
        {!scan.parsed ? <div className="scanner-placeholder"><Icon name="documents" width={34} height={34} /><p>Nach der Texterkennung erscheinen hier Datum, Beträge und Belegnummer.</p></div> : scan.parsed.type === "zReport" ? <ZReportFields parsed={scan.parsed} update={scan.updateField} bookSales={scan.bookSales} setBookSales={scan.setBookSales} /> : <InvoiceFields parsed={scan.parsed} update={scan.updateField} payment={scan.paymentMethod} setPayment={scan.setPaymentMethod} account={scan.accountCode} setAccount={scan.setAccountCode} paid={scan.invoicePaid} setPaid={scan.setInvoicePaid} />}
        {scan.differenceWarning && scan.parsed?.type === "zReport" ? <div className="alert alert-danger">Kassenabweichung erkannt: {formatCurrency(Number(scan.parsed.difference))}. Bitte prüfen.</div> : null}
        {scan.parsed ? <Button className="full-button" onClick={() => void scan.save()}>Geprüfte Daten übernehmen</Button> : null}
      </Card>
    </div>
    {scan.ocrText ? <Card><details><summary>OCR-Rohtext anzeigen</summary><pre className="ocr-text">{scan.ocrText}</pre></details></Card> : null}
  </div>;
}
