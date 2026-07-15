"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/accounting";
import { Icon } from "../Icon";
import { Badge, Button, Card, Field, PageHeader, Select } from "../ui";
import { KasBackupImportModal } from "./KasEntryReviewModal";
import { InvoiceFields, ZReportFields } from "./scanner/ReceiptForms";
import { type ScanDocumentType, useScannerController } from "./scanner/useScannerController";

export function ScannerPage() {
  const scan = useScannerController();
  const [kasOpen, setKasOpen] = useState(false);
  const [importMessage, setImportMessage] = useState("");

  return <div>
    <PageHeader title="Datenimport" subtitle="Zentrale Importstelle für PDF, Foto, CSV, TXT, Kontoauszug, Tagesabschluss, Eingangsrechnung, Zahlungsberichte und KAS-Datensicherungen." />
    {scan.error ? <div className="alert alert-danger">{scan.error}</div> : null}
    {scan.message ? <div className="alert alert-success">{scan.message}</div> : null}
    {importMessage ? <div className="alert alert-success">{importMessage}</div> : null}
    {scan.scanInfo ? <div className="alert alert-success">{scan.scanInfo}</div> : null}
    <div className="scanner-grid">
      <Card>
        <div className="card-heading"><div><h2>Universal Beleg Import</h2><p>Eine Upload-Stelle für laufende Geschäftsunterlagen und Zahlungsdateien.</p></div></div>
        <label className="dropzone">
          <input type="file" accept="application/pdf,.pdf,image/*,.csv,.txt,.tsv,text/*,*/*" onChange={(event) => scan.chooseFile(event.target.files?.[0])} />
          <span className="dropzone-icon"><Icon name="scan" width={32} height={32} /></span>
          <strong>{scan.file ? scan.file.name : "Dokument oder Exportdatei auswählen"}</strong>
          <small>PDF auch ohne .pdf-Endung, JPG, PNG, WEBP, CSV, TXT, TSV · bis 20 MB</small>
        </label>
        {scan.preview ? <div className="scan-preview">{scan.isPdf ? <object data={scan.preview} type="application/pdf" className="pdf-preview"><a href={scan.preview}>PDF öffnen</a></object> : <PreviewImage src={scan.preview} />}</div> : null}
        <Button className="full-button" disabled={!scan.file || scan.isProcessing} onClick={() => void scan.scan()}>{scan.isProcessing ? `Dokument wird gelesen ${scan.progress}%` : "Universal Import auslesen"}</Button>
        {scan.isProcessing ? <div className="progress"><span style={{ width: `${scan.progress}%` }} /></div> : null}
        <div className="alert alert-info">Kontoauszüge, Zahlungsdienstleister-Dateien, Belege und Tagesabschlüsse werden ausschließlich hier hochgeladen. Die Auswertung erfolgt anschließend im passenden Programmbereich.</div>
      </Card>
      <Card>
        <div className="card-heading"><div><h2>Erkannte Daten</h2><p>Dokumenttyp, Konto und Werte können vor dem Buchen korrigiert werden.</p></div>{scan.transactionSummary ? <Badge tone="info">Kontobewegungen</Badge> : scan.parsed ? <Badge tone="success">{scan.parsed.type === "zReport" ? "Tagesabschluss" : "Eingangsrechnung"}</Badge> : null}</div>
        {scan.transactionSummary ? <div className="calculation-box"><h3>CSV / Kontoexport erkannt</h3><div><span>Erkannt</span><strong>{scan.transactionSummary}</strong></div><div><span>Nächster Schritt</span><strong>Importieren, dann Bank & Zahlungsabgleich prüfen</strong></div></div> : null}
        {scan.parsed ? <Field label="Dokumenttyp" hint="Bei falscher Erkennung manuell umstellen."><Select value={scan.parsed.type} onChange={(event) => scan.applyDocumentType(event.target.value as ScanDocumentType)}><option value="zReport">Tagesabschluss / Z-Bericht</option><option value="supplierInvoice">Eingangsrechnung / Beleg</option></Select></Field> : null}
        {scan.incompleteWarning ? <div className="alert alert-warning">{scan.incompleteWarning}</div> : null}
        {!scan.parsed && !scan.transactionSummary ? <div className="scanner-placeholder"><Icon name="documents" width={34} height={34} /><p>Nach dem Auslesen erscheinen hier erkannte Werte, Kontobewegungen oder ein Prüfformular.</p></div> : scan.parsed?.type === "zReport" ? <ZReportFields parsed={scan.parsed} update={scan.updateField} bookSales={scan.bookSales} setBookSales={scan.setBookSales} /> : scan.parsed ? <InvoiceFields parsed={scan.parsed} update={scan.updateField} payment={scan.paymentMethod} setPayment={scan.setPaymentMethod} account={scan.accountCode} setAccount={scan.setAccountCode} paid={scan.invoicePaid} setPaid={scan.setInvoicePaid} /> : null}
        {scan.differenceWarning && scan.parsed?.type === "zReport" ? <div className="alert alert-danger">Kassenabweichung erkannt: {formatCurrency(Number(scan.parsed.difference))}. Bitte prüfen.</div> : null}
        {(scan.parsed || scan.transactionSummary) ? <Button className="full-button" onClick={() => void scan.save()}>Geprüfte Daten übernehmen</Button> : null}
      </Card>
    </div>
    <Card>
      <div className="card-heading"><div><h2>KAS-Datensicherung</h2><p>KAS-Backups werden ebenfalls nur über diese zentrale Importseite eingelesen. Vor dem Speichern werden Zeitraum, Konten, Summen und Dubletten geprüft.</p></div><Button variant="secondary" icon="upload" onClick={() => setKasOpen(true)}>KAS-Backup einlesen</Button></div>
    </Card>
    {scan.ocrText ? <Card><details><summary>Ausgelesener Rohtext anzeigen</summary><pre className="ocr-text">{scan.ocrText}</pre></details></Card> : null}
    <KasBackupImportModal open={kasOpen} onClose={() => setKasOpen(false)} onImported={(message) => { setImportMessage(message); setKasOpen(false); }} />
  </div>;
}

function PreviewImage({ src }: { src: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="Belegvorschau" />;
}
