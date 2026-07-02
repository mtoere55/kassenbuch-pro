"use client";

import { useMemo, useState } from "react";
import { calculateSaleMetrics, formatCurrency, todayIso } from "@/lib/accounting";
import { useKassenStore } from "@/lib/store";
import type { PaymentMethod } from "@/lib/types";
import { CustomerModal } from "../CustomerModal";
import { DocumentView } from "../DocumentView";
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select } from "../ui";

export function SalePage() {
  const { state, addSale } = useKassenStore();
  const available = state.devices.filter((device) => device.status === "inStock" || device.status === "reserved");
  const [deviceId, setDeviceId] = useState(available[0]?.id ?? "");
  const [customerId, setCustomerId] = useState("");
  const [date, setDate] = useState(todayIso());
  const [price, setPrice] = useState(String(available[0]?.askingPrice ?? available[0]?.purchasePrice ?? ""));
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [documentType, setDocumentType] = useState<"invoice" | "receipt">("invoice");
  const [customerModal, setCustomerModal] = useState(false);
  const [documentId, setDocumentId] = useState<string>();
  const [error, setError] = useState("");

  const device = state.devices.find((item) => item.id === deviceId);
  const numericPrice = Number(price.replace(",", ".")) || 0;
  const metrics = useMemo(
    () =>
      device
        ? calculateSaleMetrics({
            salePrice: numericPrice,
            purchasePrice: device.purchasePrice,
            repairCosts: device.repairCosts,
            taxMode: device.taxMode,
          })
        : null,
    [device, numericPrice],
  );
  const document = state.documents.find((item) => item.id === documentId);

  function chooseDevice(id: string) {
    setDeviceId(id);
    const selected = state.devices.find((item) => item.id === id);
    setPrice(String(selected?.askingPrice ?? selected?.purchasePrice ?? ""));
  }

  function submit() {
    setError("");
    if (!deviceId) return setError("Bitte ein Gerät auswählen.");
    if (numericPrice <= 0) return setError("Bitte einen gültigen Verkaufspreis eingeben.");
    try {
      const result = addSale({
        customerId: customerId || undefined,
        deviceId,
        date,
        paymentMethod,
        price: numericPrice,
        documentType,
      });
      setDocumentId(result.document.id);
      const next = state.devices.find((item) => item.status === "inStock" && item.id !== deviceId);
      setDeviceId(next?.id ?? "");
      setPrice(String(next?.askingPrice ?? ""));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Verkauf konnte nicht gespeichert werden.");
    }
  }

  return (
    <div>
      <PageHeader
        title="Gerät verkaufen"
        subtitle="Gerät wählen, Zahlung erfassen und Rechnung oder Quittung erstellen."
      />
      {error ? <div className="alert alert-danger">{error}</div> : null}
      {available.length === 0 ? (
        <Card><div className="empty-state"><h3>Kein Gerät auf Lager</h3><p>Lege zuerst über „Gerät ankaufen“ einen Bestand an.</p></div></Card>
      ) : (
        <div className="workflow-grid">
          <Card>
            <div className="step-title"><span>1</span><div><h2>Gerät und Kunde</h2><p>Das Gerät wird nach Abschluss automatisch aus dem Bestand genommen.</p></div></div>
            <div className="form-stack">
              <Field label="Gerät">
                <Select value={deviceId} onChange={(event) => chooseDevice(event.target.value)}>
                  <option value="">Gerät auswählen</option>
                  {available.map((item) => (
                    <option key={item.id} value={item.id}>{item.stockNumber} · {item.brand} {item.model} · IMEI {item.imei1}</option>
                  ))}
                </Select>
              </Field>
              {device ? (
                <div className="device-summary">
                  <div><strong>{device.brand} {device.model}</strong><span>{device.stockNumber}</span></div>
                  <div className="summary-tags"><Badge tone="info">IMEI {device.imei1}</Badge><Badge>{device.condition}</Badge><Badge tone={device.taxMode === "differential" ? "warning" : "info"}>{device.taxMode === "differential" ? "§25a" : "19 % MwSt."}</Badge></div>
                  <dl><div><dt>Einkauf</dt><dd>{formatCurrency(device.purchasePrice)}</dd></div><div><dt>Reparatur</dt><dd>{formatCurrency(device.repairCosts)}</dd></div><div><dt>Preisvorschlag</dt><dd>{formatCurrency(device.askingPrice ?? 0)}</dd></div></dl>
                </div>
              ) : null}
              <Field label="Kunde" hint="Für Laufkundschaft kann das Feld leer bleiben.">
                <div className="inline-control">
                  <Select value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
                    <option value="">Laufkundschaft</option>
                    {state.customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>{customer.company || `${customer.firstName} ${customer.lastName}`} · {customer.customerNumber}</option>
                    ))}
                  </Select>
                  <Button type="button" variant="secondary" onClick={() => setCustomerModal(true)}>Neu</Button>
                </div>
              </Field>
            </div>
          </Card>

          <Card>
            <div className="step-title"><span>2</span><div><h2>Zahlung und Beleg</h2><p>Die Buchung entsteht automatisch im Hintergrund.</p></div></div>
            <div className="form-grid two">
              <Field label="Verkaufsdatum"><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
              <Field label="Verkaufspreis"><Input type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} /></Field>
              <Field label="Zahlungsart">
                <Select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>
                  <option value="cash">Bar</option><option value="card">Karte</option><option value="bank">Überweisung</option><option value="paypal">PayPal</option>
                </Select>
              </Field>
              <Field label="Dokument">
                <Select value={documentType} onChange={(event) => setDocumentType(event.target.value as "invoice" | "receipt")}>
                  <option value="invoice">Rechnung</option><option value="receipt">Quittung</option>
                </Select>
              </Field>
            </div>
            {device && metrics ? (
              <div className="calculation-box">
                <h3>Automatische Kalkulation</h3>
                <div><span>Verkaufspreis</span><strong>{formatCurrency(numericPrice)}</strong></div>
                <div><span>Rohmarge</span><strong>{formatCurrency(metrics.grossMargin)}</strong></div>
                {device.taxMode === "differential" ? <div><span>Enthaltene Differenz-MwSt.</span><strong>{formatCurrency(metrics.differentialVat)}</strong></div> : null}
                <div className="calculation-total"><span>Ergebnis nach Steuer und Reparatur</span><strong>{formatCurrency(metrics.profitAfterVatAndRepair)}</strong></div>
              </div>
            ) : null}
            <Button className="full-button" onClick={submit}>Verkauf abschließen</Button>
          </Card>
        </div>
      )}

      <CustomerModal
        open={customerModal}
        onClose={() => setCustomerModal(false)}
        onCreated={(customer) => setCustomerId(customer.id)}
      />
      <Modal
        open={Boolean(document)}
        onClose={() => setDocumentId(undefined)}
        title="Verkauf erfolgreich gespeichert"
        wide
        footer={<><Button variant="secondary" onClick={() => setDocumentId(undefined)}>Schließen</Button><Button onClick={() => window.print()}>Drucken</Button></>}
      >
        {document ? <DocumentView document={document} /> : null}
      </Modal>
    </div>
  );
}
