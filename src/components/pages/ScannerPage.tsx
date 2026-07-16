"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/accounting";
import { Icon } from "../Icon";
import { Badge, Button, Card, Field, PageHeader, Select } from "../ui";
import { DsfinvkImportModal } from "./DsfinvkImportModal";
import { MeinbuchImportModal } from "./MeinbuchImportModal";
import { UnitelCashImportModal } from "./UnitelCashImportModal";
import { InvoiceFields, ZReportFields } from "./scanner/ReceiptForms";
import { type ScanDocumentType, useScannerController } from "./scanner/useScannerController";

export function ScannerPage() {
  const scan = useScannerController();
  const [kasOpen, setKasOpen] = useState(false);
  const [flatpayOpen, setFlatpayOpen] = useState(false);
  const [unitelOpen, setUnitelOpen] = useState(false);
  const [importMessage, setImportMessage] = useState("");

  return <div>
    <PageHeader title="Datenimport" subtitle="Zentrale Importstelle für Belege, Kontoauszüge, MeinBuch, Flatpay und vollständig bar verkaufte Unitel-/Pin-Sales-Guthaben." />
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
        <div className="alert alert-info">Kontoauszüge, Zahlungsdienstleister-Dateien, Belege und einzelne Tagesabschlüsse werden hier hochgeladen. Strukturierte Spezialexporte stehen darunter.</div>
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
    <div className="scanner-grid">
      <Card>
        <div className="card-heading"><div><h2>Unitel Barverkäufe</h2><p>Pin-Sales-Guthaben, die nicht im Kassensystem erscheinen: vollständig bar, täglich in Kasse 1000 und mit eigener Provision auf 8403.</p></div><Button variant="secondary" icon="upload" onClick={() => setUnitelOpen(true)}>Unitel-Liste einlesen</Button></div>
      </Card>
      <Card>
        <div className="card-heading"><div><h2>MeinBuch-.kas Historie</h2><p>Das alte Kassenbuch wird vollständig blockweise gelesen, originalgetreu archiviert und auf den neuen Kontenplan abgebildet.</p></div><Button variant="secondary" icon="upload" onClick={() => setKasOpen(true)}>MeinBuch übernehmen</Button></div>
      </Card>
      <Card>
        <div className="card-heading"><div><h2>Flatpay Sammelimport</h2><p>DSFinV-K/GDPdU-ZIP mit vielen Tagesabschlüssen auf einmal. Kasse, Karte, KDV, Z-Nummer und Belege werden automatisch getrennt.</p></div><Button variant="secondary" icon="upload" onClick={() => setFlatpayOpen(true)}>Flatpay-ZIP einlesen</Button></div>
      </Card>
    </div>
    {scan.ocrText ? <Card><details><summary>Ausgelesener Rohtext anzeigen</summary><pre className="ocr-text">{scan.ocrText}</pre></details></Card> : null}
    <UnitelCashImportModal open={unitelOpen} onClose={() => setUnitelOpen(false)} onImported={(message) => { setImportMessage(message); setUnitelOpen(false); }} />
    <MeinbuchImportModal open={kasOpen} onClose={() => setKasOpen(false)} onImported={(message) => { setImportMessage(message); setKasOpen(false); }} />
    <DsfinvkImportModal open={flatpayOpen} onClose={() => setFlatpayOpen(false)} onImported={(message) => { setImportMessage(message); setFlatpayOpen(false); }} />
  </div>;
}

function PreviewImage({ src }: { src: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="Belegvorschau" />;
}
