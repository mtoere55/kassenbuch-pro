"use client";

import { formatCurrency, formatDate } from "@/lib/accounting";
import { printFirst } from "@/lib/print";
import { useKassenStore } from "@/lib/store";
import type { BusinessDocument } from "@/lib/types";

export function printDocumentView() {
  printFirst(".modal .print-document, .print-document", "Kassenbuch Pro Dokument");
}

export function DocumentView({ document }: { document: BusinessDocument }) {
  const { state } = useKassenStore();
  const customer = state.customers.find((item) => item.id === document.customerId);
  const device = state.devices.find((item) => item.id === document.deviceId);
  const settings = state.settings;
  const title =
    document.type === "invoice"
      ? "Rechnung"
      : document.type === "receipt"
        ? "Quittung"
        : document.type === "purchaseContract"
          ? "Ankaufvertrag"
          : document.type === "zReport"
            ? "Tagesabschluss"
            : "Eingangsrechnung";

  return (
    <article className="print-document" data-print-kind="business-document">
      <header className="document-head">
        <div>
          <div className="document-brand">{settings.businessName}</div>
          <div>{settings.ownerName}</div>
          <div>{settings.street}</div>
          <div>{settings.postalCode} {settings.city}</div>
          <div>Tel.: {settings.phone}</div>
          <div>Steuernummer: {settings.taxNumber}</div>
        </div>
        <div className="document-meta">
          <h1>{title}</h1>
          <div><span>Nummer</span><strong>{document.documentNumber}</strong></div>
          <div><span>Datum</span><strong>{formatDate(document.date)}</strong></div>
        </div>
      </header>

      {customer ? (
        <section className="document-customer">
          <strong>{customer.company || `${customer.firstName} ${customer.lastName}`}</strong>
          {customer.street ? <div>{customer.street}</div> : null}
          {(customer.postalCode || customer.city) ? <div>{customer.postalCode} {customer.city}</div> : null}
          {customer.customerNumber ? <div>Kundennummer: {customer.customerNumber}</div> : null}
        </section>
      ) : document.type === "invoice" ? (
        <section className="document-customer"><strong>Laufkundschaft</strong></section>
      ) : null}

      {document.type === "purchaseContract" ? (
        <section className="contract-text">
          <p>
            Der Verkäufer bestätigt, dass das unten bezeichnete Gerät sein Eigentum ist,
            frei von Rechten Dritter übergeben wird und nicht aus einer Straftat stammt.
          </p>
        </section>
      ) : null}

      <table className="document-table">
        <thead>
          <tr>
            <th>Pos.</th>
            <th>Beschreibung</th>
            <th className="align-right">Betrag</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>1</td>
            <td>
              {device ? (
                <>
                  <strong>{device.brand} {device.model}</strong>
                  <div>IMEI: {device.imei1}</div>
                  {device.serialNumber ? <div>Seriennummer: {device.serialNumber}</div> : null}
                  <div>Zustand: {device.condition}</div>
                </>
              ) : (
                <strong>{title}</strong>
              )}
            </td>
            <td className="align-right">{formatCurrency(document.amount)}</td>
          </tr>
        </tbody>
      </table>

      <div className="document-total">
        <span>Gesamtbetrag</span>
        <strong>{formatCurrency(document.amount)}</strong>
      </div>

      {document.taxMode === "differential" && document.type !== "purchaseContract" ? (
        <p className="tax-note">
          Gebrauchtgegenstände/Sonderregelung. Besteuerung nach § 25a UStG.
          Die Umsatzsteuer wird nicht gesondert ausgewiesen.
        </p>
      ) : document.taxMode === "standard19" && document.type !== "zReport" ? (
        <p className="tax-note">
          Enthaltene Umsatzsteuer (19 %): {formatCurrency(document.taxAmount)}
        </p>
      ) : null}

      {document.type === "receipt" ? (
        <p className="receipt-confirmation">
          Der oben genannte Betrag wurde am {formatDate(document.date)} erhalten.
        </p>
      ) : null}

      {document.type === "purchaseContract" ? (
        <div className="signature-grid">
          <div><span>Ort, Datum</span></div>
          <div><span>Unterschrift Verkäufer</span></div>
          <div><span>Unterschrift Käufer</span></div>
        </div>
      ) : null}

      <footer className="document-footer">
        <span>{settings.businessName}</span>
        <span>{settings.email}</span>
        {settings.iban ? <span>IBAN: {settings.iban}</span> : null}
      </footer>
    </article>
  );
}