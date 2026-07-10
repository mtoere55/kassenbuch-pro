"use client";

import { useState } from "react";
import { getImeiValidationMessage, normalizeImei, todayIso } from "@/lib/accounting";
import { useKassenStore } from "@/lib/store";
import type { Device, PaymentMethod, TaxMode } from "@/lib/types";
import { CustomerModal } from "../CustomerModal";
import { DocumentView } from "../DocumentView";
import { Button, Card, Field, Input, Modal, PageHeader, Select } from "../ui";

export function PurchasePage() {
  const { state, addPurchase } = useKassenStore();
  const [customerId, setCustomerId] = useState(state.customers[0]?.id ?? "");
  const [date, setDate] = useState(todayIso());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [taxMode, setTaxMode] = useState<TaxMode>("differential");
  const [category, setCategory] = useState("Smartphone");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [imei1, setImei1] = useState("");
  const [imei2, setImei2] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [storage, setStorage] = useState("");
  const [color, setColor] = useState("");
  const [condition, setCondition] = useState<Device["condition"]>("good");
  const [price, setPrice] = useState("");
  const [repairCosts, setRepairCosts] = useState("0");
  const [askingPrice, setAskingPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [customerModal, setCustomerModal] = useState(false);
  const [documentId, setDocumentId] = useState<string>();
  const [error, setError] = useState("");

  const document = state.documents.find((item) => item.id === documentId);

  function reset() {
    setBrand("");
    setModel("");
    setImei1("");
    setImei2("");
    setSerialNumber("");
    setStorage("");
    setColor("");
    setPrice("");
    setRepairCosts("0");
    setAskingPrice("");
    setNotes("");
  }

  function submit() {
    setError("");
    if (!customerId) return setError("Für einen Ankauf muss ein Verkäufer ausgewählt werden.");
    if (!brand.trim() || !model.trim()) return setError("Bitte Marke und Modell eingeben.");
    const imei1Error = getImeiValidationMessage(imei1, "IMEI 1");
    if (imei1Error) return setError(imei1Error);
    const imei2Error = imei2 ? getImeiValidationMessage(imei2, "IMEI 2") : undefined;
    if (imei2Error) return setError(imei2Error);
    const numericPrice = Number(price.replace(",", "."));
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) return setError("Bitte einen gültigen Ankaufspreis eingeben.");
    try {
      const result = addPurchase({
        customerId,
        date,
        paymentMethod,
        price: numericPrice,
        taxMode,
        category,
        brand: brand.trim(),
        model: model.trim(),
        imei1: normalizeImei(imei1),
        imei2: imei2 ? normalizeImei(imei2) : undefined,
        serialNumber: serialNumber.trim() || undefined,
        storage: storage.trim() || undefined,
        color: color.trim() || undefined,
        condition,
        repairCosts: Number(repairCosts.replace(",", ".")) || 0,
        askingPrice: Number(askingPrice.replace(",", ".")) || undefined,
        notes: notes.trim() || undefined,
      });
      setDocumentId(result.document.id);
      reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ankauf konnte nicht gespeichert werden.");
    }
  }

  return (
    <div>
      <PageHeader
        title="Gerät ankaufen"
        subtitle="Verkäufer, IMEI und Ankaufspreis erfassen. Bestand, Ausgabe und Ankaufvertrag entstehen automatisch."
      />
      {error ? <div className="alert alert-danger">{error}</div> : null}
      <div className="workflow-grid">
        <Card>
          <div className="step-title"><span>1</span><div><h2>Verkäufer und Zahlung</h2><p>Der Verkäufer wird dauerhaft mit dem Gerät verknüpft.</p></div></div>
          <div className="form-stack">
            <Field label="Verkäufer">
              <div className="inline-control">
                <Select value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
                  <option value="">Verkäufer auswählen</option>
                  {state.customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>{customer.company || `${customer.firstName} ${customer.lastName}`} · {customer.customerNumber}</option>
                  ))}
                </Select>
                <Button type="button" variant="secondary" onClick={() => setCustomerModal(true)}>Neu</Button>
              </div>
            </Field>
            <div className="form-grid two">
              <Field label="Ankaufsdatum"><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
              <Field label="Zahlungsart">
                <Select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>
                  <option value="cash">Bar</option><option value="bank">Überweisung</option><option value="paypal">PayPal</option><option value="card">Karte</option>
                </Select>
              </Field>
              <Field label="Ankaufspreis"><Input type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} /></Field>
              <Field label="Steuerbehandlung">
                <Select value={taxMode} onChange={(event) => setTaxMode(event.target.value as TaxMode)}>
                  <option value="differential">Differenzbesteuerung §25a</option>
                  <option value="standard19">Regelbesteuerung 19 %</option>
                  <option value="taxFree">Steuerfrei / Sonderfall</option>
                </Select>
              </Field>
            </div>
            {taxMode === "differential" ? <div className="alert alert-info">Für gebrauchte Geräte ohne abziehbare Vorsteuer. Die endgültige steuerliche Einordnung muss zu deinem Beleg passen.</div> : null}
          </div>
        </Card>

        <Card>
          <div className="step-title"><span>2</span><div><h2>Gerät erfassen</h2><p>Die IMEI dient als eindeutiger Schlüssel im gesamten System.</p></div></div>
          <div className="form-grid two">
            <Field label="Kategorie"><Select value={category} onChange={(event) => setCategory(event.target.value)}><option>Smartphone</option><option>Tablet</option><option>Laptop</option><option>Smartwatch</option><option>Konsole</option><option>Sonstiges</option></Select></Field>
            <Field label="Zustand"><Select value={condition} onChange={(event) => setCondition(event.target.value as Device["condition"])}><option value="new">Neu</option><option value="veryGood">Sehr gut</option><option value="good">Gut</option><option value="used">Gebraucht</option><option value="defective">Defekt</option></Select></Field>
            <Field label="Marke"><Input placeholder="z. B. Apple" value={brand} onChange={(event) => setBrand(event.target.value)} /></Field>
            <Field label="Modell"><Input placeholder="z. B. iPhone 13" value={model} onChange={(event) => setModel(event.target.value)} /></Field>
            <Field label="IMEI 1" hint="15-stellig; Prüfziffer und Dubletten werden geprüft."><Input inputMode="numeric" value={imei1} onChange={(event) => setImei1(normalizeImei(event.target.value))} /></Field>
            <Field label="IMEI 2"><Input inputMode="numeric" value={imei2} onChange={(event) => setImei2(normalizeImei(event.target.value))} /></Field>
            <Field label="Seriennummer"><Input value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} /></Field>
            <Field label="Speicher"><Input placeholder="128 GB" value={storage} onChange={(event) => setStorage(event.target.value)} /></Field>
            <Field label="Farbe"><Input value={color} onChange={(event) => setColor(event.target.value)} /></Field>
            <Field label="Geplanter Verkaufspreis"><Input type="number" min="0" step="0.01" value={askingPrice} onChange={(event) => setAskingPrice(event.target.value)} /></Field>
            <Field label="Reparaturkosten"><Input type="number" min="0" step="0.01" value={repairCosts} onChange={(event) => setRepairCosts(event.target.value)} /></Field>
            <Field label="Notiz"><Input value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
          </div>
          <Button className="full-button" onClick={submit}>Ankauf abschließen</Button>
        </Card>
      </div>

      <CustomerModal open={customerModal} onClose={() => setCustomerModal(false)} onCreated={(customer) => setCustomerId(customer.id)} />
      <Modal
        open={Boolean(document)}
        onClose={() => setDocumentId(undefined)}
        title="Ankauf erfolgreich gespeichert"
        wide
        footer={<><Button variant="secondary" onClick={() => setDocumentId(undefined)}>Schließen</Button><Button onClick={() => window.print()}>Ankaufvertrag drucken</Button></>}
      >
        {document ? <DocumentView document={document} /> : null}
      </Modal>
    </div>
  );
}
