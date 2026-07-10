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
  const isRepair = Boolean(document.repairId || document.metadata?.repairNumber);
  const title =
    document.type === "invoice"
      ? "Rechnung"
      : document.type === "receipt"
        ? "Quittung"
        : document.type === "estimate"
          ? "Kostenvoranschlag"
          : document.type === "purchaseContract"
            ? "Ankaufvertrag"
            : document.type === "zReport"
              ? "Tagesabschluss"
              : "Eingangsrechnung";
  const repairBrand = textMeta(document, "repairBrand");
  const repairModel = textMeta(document, "repairModel");
  const repairImei = textMeta(document, "repairImei");
  const repairSerial = textMeta(document, "repairSerialNumber");
  const repairIssue = textMeta(document, "repairIssue");
  const repairWork = textMeta(document, "repairWorkDescription");
  const repairAccessories = textMeta(document, "repairAccessories");
  const repairPasscode = textMeta(document, "repairPasscode");
  const repairNumber = textMeta(document, "repairNumber");

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
          {repairNumber ? <div><span>Service Nr.</span><strong>{repairNumber}</strong></div> : null}
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
      ) : document.type === "invoice" || document.type === "estimate" ? (
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

      {isRepair ? (
        <section className="contract-text">
          <p><strong>Serviceauftrag:</strong> {repairIssue || "Reparatur / Service"}</p>
          {repairAccessories ? <p><strong>Mitgegebenes Zubehör:</strong> {repairAccessories}</p> : null}
          {repairPasscode ? <p><strong>Code / Sperre:</strong> {repairPasscode}</p> : null}
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
              {isRepair ? (
                <>
                  <strong>{repairWork || "Reparatur / Service"}</strong>
                  <div>{repairBrand} {repairModel}</div>
                  {repairImei ? <div>IMEI: {repairImei}</div> : null}
                  {repairSerial ? <div>Seriennummer: {repairSerial}</div> : null}
                </>
              ) : device ? (
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

      {document.type === "estimate" ? (
        <p className="tax-note">
          Dieser Kostenvoranschlag ist noch keine Zahlung und wurde nicht ins Kassenbuch gebucht.
          Eine Buchung entsteht erst bei Rechnung oder Quittung.
        </p>
      ) : document.taxMode === "differential" && document.type !== "purchaseContract" ? (
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
      ) : isRepair ? (
        <div className="signature-grid">
          <div><span>Ort, Datum</span></div>
          <div><span>Unterschrift Kunde</span></div>
          <div><span>Unterschrift Annahme</span></div>
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

function textMeta(document: BusinessDocument, key: string): string {
  const value = document.metadata?.[key];
  return typeof value === "string" ? value : "";
}
