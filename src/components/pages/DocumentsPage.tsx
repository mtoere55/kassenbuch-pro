"use client";

import { useMemo, useState } from "react";
import { formatCurrency, formatDate } from "@/lib/accounting";
import { useKassenStore } from "@/lib/store";
import type { BusinessDocument, DocumentType } from "@/lib/types";
import { DocumentView } from "../DocumentView";
import { Icon } from "../Icon";
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select } from "../ui";

export function DocumentsPage() {
  const { state } = useKassenStore();
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"all" | DocumentType>("all");
  const [selectedId, setSelectedId] = useState<string>();
  const selected = state.documents.find((document) => document.id === selectedId);
  const filtered = useMemo(() => {
    const needle = query.toLowerCase().trim();
    return state.documents.filter((document) => {
      const customer = state.customers.find((item) => item.id === document.customerId);
      const device = state.devices.find((item) => item.id === document.deviceId);
      const text = [
        document.documentNumber,
        customer?.firstName,
        customer?.lastName,
        customer?.company,
        device?.brand,
        device?.model,
        device?.imei1,
        document.metadata?.vendor,
        document.originalFileName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return (type === "all" || document.type === type) && (!needle || text.includes(needle));
    });
  }, [query, state.customers, state.devices, state.documents, type]);

  return (
    <div>
      <PageHeader title="Dokumente" subtitle="Rechnungen, Quittungen, Ankaufverträge und gescannte Belege." />
      <Card>
        <div className="toolbar">
          <div className="search-box">
            <Icon name="search" width={18} height={18} />
            <Input
              placeholder="Nummer, Kunde, Gerät, IMEI oder Dateiname"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Select value={type} onChange={(event) => setType(event.target.value as "all" | DocumentType)}>
            <option value="all">Alle Dokumente</option>
            <option value="invoice">Rechnungen</option>
            <option value="receipt">Quittungen</option>
            <option value="purchaseContract">Ankaufverträge</option>
            <option value="supplierInvoice">Eingangsrechnungen</option>
            <option value="zReport">Tagesabschlüsse</option>
          </Select>
        </div>
        {filtered.length === 0 ? (
          <EmptyState icon="documents" title="Keine Dokumente gefunden" text="Neue Belege entstehen automatisch aus Verkauf, Ankauf oder Scanner." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Dokument</th><th>Datum</th><th>Bezug</th><th>Betrag</th><th>Status</th><th /></tr></thead>
              <tbody>
                {filtered.map((document) => {
                  const customer = state.customers.find((item) => item.id === document.customerId);
                  const device = state.devices.find((item) => item.id === document.deviceId);
                  const difference = Number(document.metadata?.difference ?? 0);
                  return <tr key={document.id}>
                    <td><strong>{document.documentNumber}</strong><small>{documentTypeLabel(document.type)}</small></td>
                    <td>{formatDate(document.date)}</td>
                    <td>
                      <span>{customer ? customer.company || `${customer.firstName} ${customer.lastName}` : String(document.metadata?.vendor || "–")}</span>
                      <small>{device ? `${device.brand} ${device.model} · ${device.imei1}` : document.originalFileName || ""}</small>
                    </td>
                    <td><strong>{formatCurrency(document.amount)}</strong><small>{document.taxMode === "differential" ? "§25a" : document.taxAmount ? `${formatCurrency(document.taxAmount)} Steuer` : ""}</small></td>
                    <td>
                      {document.type === "zReport" && difference !== 0
                        ? <Badge tone="danger">Differenz {formatCurrency(difference)}</Badge>
                        : <Badge tone={document.status === "paid" || document.status === "archived" ? "success" : "warning"}>{statusLabel(document.status)}</Badge>}
                    </td>
                    <td className="align-right"><Button variant="secondary" onClick={() => setSelectedId(document.id)}>Anzeigen</Button></td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Modal
        open={Boolean(selected)}
        onClose={() => setSelectedId(undefined)}
        title={selected ? `${documentTypeLabel(selected.type)} ${selected.documentNumber}` : "Dokument"}
        wide
        footer={<><Button variant="secondary" onClick={() => setSelectedId(undefined)}>Schließen</Button><Button icon="print" onClick={() => window.print()}>Drucken</Button></>}
      >
        {selected
          ? selected.type === "zReport" || selected.type === "supplierInvoice"
            ? <ScannedDocumentDetails document={selected} />
            : <DocumentView document={selected} />
          : null}
      </Modal>
    </div>
  );
}

function documentTypeLabel(type: DocumentType) {
  return ({ invoice: "Rechnung", receipt: "Quittung", purchaseContract: "Ankaufvertrag", zReport: "Tagesabschluss", supplierInvoice: "Eingangsrechnung" } as const)[type];
}

function statusLabel(status: BusinessDocument["status"]) {
  return ({ draft: "Entwurf", open: "Offen", paid: "Bezahlt", archived: "Archiviert" } as const)[status];
}

function metadataLabel(key: string) {
  return ({ vendor: "Lieferant", invoiceNumber: "Rechnungsnummer", zNumber: "Z-Bericht Nr.", cash: "Bar", card: "Karte", salesCount: "Verkäufe", difference: "Differenz", bookSales: "Umsatz gebucht" } as Record<string, string>)[key] || key;
}

function isPdfDocument(document: BusinessDocument) {
  return document.originalFileName?.toLowerCase().endsWith(".pdf") || document.originalImageDataUrl?.startsWith("data:application/pdf");
}

function ScannedDocumentDetails({ document }: { document: BusinessDocument }) {
  const hasStoredOriginal = Boolean(document.originalImageDataUrl);
  const pdf = isPdfDocument(document);
  return <div className={`scan-document-detail ${hasStoredOriginal ? "" : "without-preview"}`}>
    {hasStoredOriginal ? (
      pdf ? (
        <object data={document.originalImageDataUrl} type="application/pdf" className="pdf-preview" aria-label={document.documentNumber}>
          <a href={document.originalImageDataUrl} target="_blank" rel="noreferrer">PDF in neuem Fenster öffnen</a>
        </object>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={document.originalImageDataUrl} alt={document.documentNumber} />
      )
    ) : (
      <div className="scanner-placeholder document-file-placeholder">
        <Icon name="documents" width={34} height={34} />
        <p>Die Originaldatei wurde wegen der lokalen Speichergrenze nicht eingebettet.</p>
        {document.originalFileName ? <strong>{document.originalFileName}</strong> : null}
      </div>
    )}
    <div>
      <dl className="detail-list">
        <div><dt>Typ</dt><dd>{documentTypeLabel(document.type)}</dd></div>
        <div><dt>Datum</dt><dd>{formatDate(document.date)}</dd></div>
        <div><dt>Gesamt</dt><dd>{formatCurrency(document.amount)}</dd></div>
        <div><dt>Steuer</dt><dd>{formatCurrency(document.taxAmount)}</dd></div>
        <div><dt>Status</dt><dd>{statusLabel(document.status)}</dd></div>
        {document.originalFileName ? <div><dt>Datei</dt><dd>{document.originalFileName}</dd></div> : null}
        {Object.entries(document.metadata ?? {}).map(([key, value]) => <div key={key}><dt>{metadataLabel(key)}</dt><dd>{String(value ?? "–")}</dd></div>)}
      </dl>
      {document.ocrText ? <details><summary>OCR-Rohtext anzeigen</summary><pre className="ocr-text">{document.ocrText}</pre></details> : null}
    </div>
  </div>;
}
