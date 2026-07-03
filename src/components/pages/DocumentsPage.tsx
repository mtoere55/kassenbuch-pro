"use client";

import { useMemo, useState } from "react";
import { formatCurrency, formatDate } from "@/lib/accounting";
import {
  getSupplierAccount,
  supplierInvoiceDuplicateKey,
  supplierInvoiceKeyFromDocument,
} from "@/lib/document-control";
import { parseDecimal, validateSupplierInvoiceAmounts } from "@/lib/invoice-validation";
import { useKassenStore } from "@/lib/store";
import type { BusinessDocument, DocumentType } from "@/lib/types";
import { DocumentView } from "../DocumentView";
import { Icon } from "../Icon";
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select } from "../ui";
import {
  createScannedInvoiceDraft,
  EditScannedInvoice,
  type ScannedInvoiceDraft,
} from "./documents/EditScannedInvoice";

export function DocumentsPage() {
  const { state, replaceState } = useKassenStore();
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"all" | DocumentType>("all");
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [editDraft, setEditDraft] = useState<ScannedInvoiceDraft>();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const selected = state.documents.find((document) => document.id === selectedId);

  const duplicateCounts = useMemo(() => {
    const counts = new Map<string, number>();
    state.documents.forEach((document) => {
      const key = supplierInvoiceKeyFromDocument(document);
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }, [state.documents]);

  function isDuplicate(document: BusinessDocument) {
    const key = supplierInvoiceKeyFromDocument(document);
    return Boolean(key && (duplicateCounts.get(key) || 0) > 1);
  }

  const duplicateDocumentCount = state.documents.filter(isDuplicate).length;

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
      return (
        (type === "all" || document.type === type) &&
        (!duplicatesOnly || isDuplicate(document)) &&
        (!needle || text.includes(needle))
      );
    });
  }, [duplicatesOnly, duplicateCounts, query, state.customers, state.devices, state.documents, type]);

  function canDelete(document?: BusinessDocument) {
    return document?.type === "supplierInvoice" || document?.type === "zReport";
  }

  function canEdit(document?: BusinessDocument) {
    return document?.type === "supplierInvoice";
  }

  function closeDocument() {
    setSelectedId(undefined);
    setEditDraft(undefined);
  }

  function openDocument(document: BusinessDocument) {
    setError("");
    setSelectedId(document.id);
    setEditDraft(undefined);
  }

  function startEditing(document: BusinessDocument) {
    if (!canEdit(document)) return;
    setError("");
    setSelectedId(document.id);
    setEditDraft(createScannedInvoiceDraft(document));
  }

  function saveInvoiceChanges() {
    if (!selected || selected.type !== "supplierInvoice" || !editDraft) return;
    setError("");
    setMessage("");

    try {
      const amounts = validateSupplierInvoiceAmounts(
        parseDecimal(editDraft.gross),
        parseDecimal(editDraft.vat),
      );
      const vendor = editDraft.vendor.trim() || "Unbekannter Lieferant";
      const invoiceNumber = editDraft.invoiceNumber.trim();
      const account = getSupplierAccount(editDraft.accountCode);
      const paid = editDraft.status === "paid";
      const paymentAccount = {
        cash: "1000",
        card: "1360",
        bank: "1200",
        paypal: "1370",
      }[editDraft.paymentMethod];
      const amountOrPaymentChanged =
        selected.amount !== amounts.gross ||
        selected.paymentMethod !== editDraft.paymentMethod ||
        selected.status !== editDraft.status;

      const updatedDocument: BusinessDocument = {
        ...selected,
        date: editDraft.date,
        amount: amounts.gross,
        taxAmount: amounts.vat,
        taxMode: amounts.vat > 0 ? "standard19" : "taxFree",
        paymentMethod: editDraft.paymentMethod,
        status: editDraft.status,
        metadata: {
          ...(selected.metadata ?? {}),
          vendor,
          invoiceNumber: invoiceNumber || null,
          accountCode: account.code,
          accountLabel: account.label,
          duplicateKey: supplierInvoiceDuplicateKey({
            vendor,
            date: editDraft.date,
            gross: amounts.gross,
            invoiceNumber: invoiceNumber || undefined,
            fileName: selected.originalFileName,
          }),
          automaticallyBooked: true,
          manuallyCorrected: true,
        },
      };

      replaceState({
        ...state,
        documents: state.documents.map((document) =>
          document.id === selected.id ? updatedDocument : document,
        ),
        ledger: state.ledger.map((entry) =>
          entry.documentId === selected.id
            ? {
                ...entry,
                date: editDraft.date,
                amount: amounts.gross,
                paymentMethod: editDraft.paymentMethod,
                description: `Eingangsrechnung ${vendor}`,
                category: `${account.code} · ${account.label}`,
                taxAmount: amounts.vat,
                taxRate: amounts.vat > 0 ? 19 : 0,
                taxMode: amounts.vat > 0 ? "standard19" : "taxFree",
                reconciled:
                  paid &&
                  (editDraft.paymentMethod === "cash" || editDraft.paymentMethod === "card"),
                accountCode: account.code,
                counterAccountCode: paymentAccount,
                cashChange:
                  editDraft.paymentMethod === "cash" && paid ? -amounts.gross : 0,
                netAmount: amounts.net,
              }
            : entry,
        ),
        importedTransactions: amountOrPaymentChanged
          ? state.importedTransactions.map((transaction) =>
              transaction.matchedDocumentId === selected.id
                ? {
                    ...transaction,
                    matchedDocumentId: undefined,
                    matchedLedgerEntryId: undefined,
                    matchConfidence: 0,
                    status: "needsReview" as const,
                  }
                : transaction,
            )
          : state.importedTransactions,
      });
      setEditDraft(undefined);
      setMessage(
        `${selected.documentNumber} wurde korrigiert. Dokument und verbundene Buchhaltung wurden gleichzeitig aktualisiert.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Die Rechnung konnte nicht korrigiert werden.");
    }
  }

  function deleteScannedDocument(document: BusinessDocument) {
    setError("");
    setMessage("");
    if (!canDelete(document)) {
      setError("Verkaufsrechnungen und Ankaufverträge müssen später über eine Stornofunktion korrigiert werden.");
      return;
    }

    const linkedLedger = state.ledger.filter((entry) => entry.documentId === document.id);
    const matchedTransactions = state.importedTransactions.filter(
      (transaction) => transaction.matchedDocumentId === document.id,
    );
    const duplicateText = isDuplicate(document)
      ? " Diese Rechnung wurde als mögliche Dublette erkannt."
      : "";
    const matchText = matchedTransactions.length
      ? ` ${matchedTransactions.length} Zahlungszuordnung(en) werden wieder auf Prüfung gesetzt.`
      : "";
    const confirmed = window.confirm(
      `${document.documentNumber} wirklich löschen?${duplicateText}\n\nDas Dokument und ${linkedLedger.length} verbundene Buchung(en) werden entfernt.${matchText}`,
    );
    if (!confirmed) return;

    replaceState({
      ...state,
      documents: state.documents.filter((item) => item.id !== document.id),
      ledger: state.ledger.filter((entry) => entry.documentId !== document.id),
      importedTransactions: state.importedTransactions.map((transaction) =>
        transaction.matchedDocumentId === document.id
          ? {
              ...transaction,
              matchedDocumentId: undefined,
              matchedLedgerEntryId: undefined,
              matchConfidence: 0,
              status: "needsReview" as const,
            }
          : transaction,
      ),
    });
    closeDocument();
    setMessage(
      `${document.documentNumber} wurde gelöscht. ${linkedLedger.length} verbundene Buchung(en) wurden ebenfalls aus der Buchhaltung entfernt.`,
    );
  }

  return (
    <div>
      <PageHeader
        title="Dokumente"
        subtitle="Rechnungen, Quittungen, Ankaufverträge und gescannte Belege."
      />
      {message ? <div className="alert alert-success">{message}</div> : null}
      {error ? <div className="alert alert-danger">{error}</div> : null}
      {duplicateDocumentCount > 0 ? (
        <div className="alert alert-warning">
          {duplicateDocumentCount} Eingangsrechnung(en) sehen wie Dubletten aus. Mit „Nur Dubletten“ kannst du sie prüfen und über „Löschen“ bereinigen.
        </div>
      ) : null}
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
          <Button
            variant={duplicatesOnly ? "primary" : "secondary"}
            onClick={() => setDuplicatesOnly((current) => !current)}
          >
            {duplicatesOnly
              ? "Alle anzeigen"
              : `Nur Dubletten${duplicateDocumentCount ? ` (${duplicateDocumentCount})` : ""}`}
          </Button>
          <Select
            value={type}
            onChange={(event) => setType(event.target.value as "all" | DocumentType)}
          >
            <option value="all">Alle Dokumente</option>
            <option value="invoice">Rechnungen</option>
            <option value="receipt">Quittungen</option>
            <option value="purchaseContract">Ankaufverträge</option>
            <option value="supplierInvoice">Eingangsrechnungen</option>
            <option value="zReport">Tagesabschlüsse</option>
          </Select>
        </div>
        {filtered.length === 0 ? (
          <EmptyState
            icon="documents"
            title="Keine Dokumente gefunden"
            text={
              duplicatesOnly
                ? "Zurzeit wurden keine Dubletten gefunden."
                : "Neue Belege entstehen automatisch aus Verkauf, Ankauf oder Scanner."
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Dokument</th><th>Datum</th><th>Bezug</th><th>Betrag</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {filtered.map((document) => {
                  const customer = state.customers.find((item) => item.id === document.customerId);
                  const device = state.devices.find((item) => item.id === document.deviceId);
                  const difference = Number(document.metadata?.difference ?? 0);
                  const duplicate = isDuplicate(document);
                  return (
                    <tr key={document.id}>
                      <td><strong>{document.documentNumber}</strong><small>{documentTypeLabel(document.type)}</small></td>
                      <td>{formatDate(document.date)}</td>
                      <td>
                        <span>
                          {customer
                            ? customer.company || `${customer.firstName} ${customer.lastName}`
                            : String(document.metadata?.vendor || "–")}
                        </span>
                        <small>
                          {device
                            ? `${device.brand} ${device.model} · ${device.imei1}`
                            : document.originalFileName || ""}
                        </small>
                      </td>
                      <td>
                        <strong>{formatCurrency(document.amount)}</strong>
                        <small>
                          {document.taxMode === "differential"
                            ? "§25a"
                            : document.taxAmount
                              ? `${formatCurrency(document.taxAmount)} Steuer`
                              : ""}
                        </small>
                      </td>
                      <td>
                        <div className="badge-row">
                          {duplicate ? <Badge tone="warning">Mögliche Dublette</Badge> : null}
                          {document.type === "zReport" && difference !== 0 ? (
                            <Badge tone="danger">Differenz {formatCurrency(difference)}</Badge>
                          ) : (
                            <Badge
                              tone={
                                document.status === "paid" || document.status === "archived"
                                  ? "success"
                                  : "warning"
                              }
                            >
                              {statusLabel(document.status)}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="align-right">
                        <div className="document-actions">
                          <Button variant="secondary" onClick={() => openDocument(document)}>
                            Anzeigen
                          </Button>
                          {canEdit(document) ? (
                            <Button variant="secondary" onClick={() => startEditing(document)}>
                              Bearbeiten
                            </Button>
                          ) : null}
                          {canDelete(document) ? (
                            <Button variant="danger" onClick={() => deleteScannedDocument(document)}>
                              Löschen
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Modal
        open={Boolean(selected)}
        onClose={closeDocument}
        title={
          selected
            ? `${editDraft ? "Eingangsrechnung bearbeiten" : documentTypeLabel(selected.type)} ${selected.documentNumber}`
            : "Dokument"
        }
        wide
        footer={
          editDraft ? (
            <>
              <Button variant="secondary" onClick={() => setEditDraft(undefined)}>
                Abbrechen
              </Button>
              <Button onClick={saveInvoiceChanges}>Änderungen speichern</Button>
            </>
          ) : (
            <>
              {selected && canEdit(selected) ? (
                <Button variant="secondary" onClick={() => startEditing(selected)}>
                  Bearbeiten
                </Button>
              ) : null}
              {selected && canDelete(selected) ? (
                <Button variant="danger" onClick={() => deleteScannedDocument(selected)}>
                  Dokument löschen
                </Button>
              ) : null}
              <Button variant="secondary" onClick={closeDocument}>Schließen</Button>
              <Button icon="print" onClick={() => window.print()}>Drucken</Button>
            </>
          )
        }
      >
        {selected ? (
          editDraft ? (
            <EditScannedInvoice draft={editDraft} onChange={setEditDraft} />
          ) : selected.type === "zReport" || selected.type === "supplierInvoice" ? (
            <ScannedDocumentDetails document={selected} />
          ) : (
            <DocumentView document={selected} />
          )
        ) : null}
      </Modal>
    </div>
  );
}

function documentTypeLabel(type: DocumentType) {
  return ({
    invoice: "Rechnung",
    receipt: "Quittung",
    purchaseContract: "Ankaufvertrag",
    zReport: "Tagesabschluss",
    supplierInvoice: "Eingangsrechnung",
  } as const)[type];
}

function statusLabel(status: BusinessDocument["status"]) {
  return ({ draft: "Entwurf", open: "Offen", paid: "Bezahlt", archived: "Archiviert" } as const)[status];
}

function metadataLabel(key: string) {
  return ({
    vendor: "Lieferant",
    invoiceNumber: "Rechnungsnummer",
    zNumber: "Z-Bericht Nr.",
    cash: "Bar",
    card: "Karte",
    salesCount: "Verkäufe",
    difference: "Differenz",
    bookSales: "Umsatz gebucht",
    accountCode: "Buchungskonto",
    accountLabel: "Kontobezeichnung",
    automaticallyBooked: "Automatisch gebucht",
    manuallyCorrected: "Manuell korrigiert",
    duplicateKey: "Dublettenschlüssel",
  } as Record<string, string>)[key] || key;
}

function isPdfDocument(document: BusinessDocument) {
  return (
    document.originalFileName?.toLowerCase().endsWith(".pdf") ||
    document.originalImageDataUrl?.startsWith("data:application/pdf")
  );
}

function ScannedDocumentDetails({ document }: { document: BusinessDocument }) {
  const hasStoredOriginal = Boolean(document.originalImageDataUrl);
  const pdf = isPdfDocument(document);
  return (
    <div className={`scan-document-detail ${hasStoredOriginal ? "" : "without-preview"}`}>
      {hasStoredOriginal ? (
        pdf ? (
          <object
            data={document.originalImageDataUrl}
            type="application/pdf"
            className="pdf-preview"
            aria-label={document.documentNumber}
          >
            <a href={document.originalImageDataUrl} target="_blank" rel="noreferrer">
              PDF in neuem Fenster öffnen
            </a>
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
          {Object.entries(document.metadata ?? {}).map(([key, value]) => (
            <div key={key}><dt>{metadataLabel(key)}</dt><dd>{String(value ?? "–")}</dd></div>
          ))}
        </dl>
        {document.ocrText ? (
          <details><summary>OCR-Rohtext anzeigen</summary><pre className="ocr-text">{document.ocrText}</pre></details>
        ) : null}
      </div>
    </div>
  );
}
