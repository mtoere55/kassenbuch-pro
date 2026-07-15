"use client";

import { Fragment, useMemo, useState } from "react";
import { formatCurrency, todayIso } from "@/lib/accounting";
import { parseMoney } from "@/lib/manual-booking";
import { createServiceBooking, type ServiceBookingKind } from "@/lib/service-booking";
import { useKassenStore } from "@/lib/store";
import type { PaymentMethod } from "@/lib/types";
import { Button, Field, Input, Modal, Select } from "../ui";

export function ServiceBookingModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { state, replaceState } = useKassenStore();
  const [kind, setKind] = useState<ServiceBookingKind>("unitelTopup");
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState("");
  const [commission, setCommission] = useState("");
  const [ownShare, setOwnShare] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [createReceipt, setCreateReceipt] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const total = parseMoney(amount);
  const commissionAmount = parseMoney(commission);
  const ownShareAmount = ownShare.trim() ? parseMoney(ownShare) : total / 2;
  const preview = useMemo(() => {
    if (kind === "unitelTopup") {
      return {
        firstLabel: "UniTel-Verrechnung 1590",
        firstAmount: Math.max(0, total - commissionAmount),
        secondLabel: "Provision 8403",
        secondAmount: commissionAmount,
      };
    }
    if (kind === "unitelCommission") {
      return {
        firstLabel: "Provision 8403",
        firstAmount: total,
        secondLabel: "",
        secondAmount: 0,
      };
    }
    return {
      firstLabel: "Prifoto-Verrechnung 1592",
      firstAmount: Math.max(0, total - ownShareAmount),
      secondLabel: "Eigenanteil 8401",
      secondAmount: ownShareAmount,
    };
  }, [commissionAmount, kind, ownShareAmount, total]);

  function switchKind(next: ServiceBookingKind) {
    setKind(next);
    setError("");
    setAmount("");
    setCommission("");
    setOwnShare("");
    setCreateReceipt(false);
    setNote("");
  }

  function save() {
    setError("");
    try {
      const result = createServiceBooking(state, {
        kind,
        date,
        amount: total,
        paymentMethod,
        commissionAmount: kind === "unitelTopup" ? commissionAmount : undefined,
        ownShareAmount: kind === "prifotoSale" ? ownShareAmount : undefined,
        createReceipt,
        note,
      });
      replaceState(result.state);
      onSaved(`${serviceLabel(kind)} wurde mit ${result.entries.length} Buchung(en) gespeichert.${result.document ? ` Quittung ${result.document.documentNumber} wurde erstellt.` : ""}`);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Der Vorgang konnte nicht gespeichert werden.");
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Guthaben / Prifoto buchen"
      wide
      footer={<Fragment><Button variant="secondary" onClick={onClose}>Abbrechen</Button><Button onClick={save}>Buchen</Button></Fragment>}
    >
      <div className="booking-kind-tabs">
        <button className={kind === "unitelTopup" ? "active" : ""} onClick={() => switchKind("unitelTopup")}>UniTel Guthaben</button>
        <button className={kind === "unitelCommission" ? "active" : ""} onClick={() => switchKind("unitelCommission")}>UniTel Provision</button>
        <button className={kind === "prifotoSale" ? "active" : ""} onClick={() => switchKind("prifotoSale")}>Prifoto 50/50</button>
      </div>

      {error ? <div className="alert alert-danger">{error}</div> : null}
      <div className="alert alert-info">
        {kind === "unitelTopup"
          ? "Der Guthaben-Nennwert wird auf 1590 geführt. Nur die eingetragene Provision wird als Erlös gebucht."
          : kind === "unitelCommission"
            ? "Vertrags- oder Partnerprovision wird auf 8403 gebucht."
            : "Die Kundenzahlung wird in Prifoto-Fremdanteil 1592 und eigenen Provisionserlös 8401 geteilt."}
      </div>

      <div className="form-grid two">
        <Field label="Datum"><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
        <Field label="Gesamtbetrag"><Input inputMode="decimal" value={amount} placeholder="0,00" onChange={(event) => setAmount(event.target.value)} /></Field>
        {kind === "unitelTopup" ? <Field label="Enthaltene Provision"><Input inputMode="decimal" value={commission} placeholder="0,00 (optional)" onChange={(event) => setCommission(event.target.value)} /></Field> : null}
        {kind === "prifotoSale" ? <Field label="Eigener Anteil"><Input inputMode="decimal" value={ownShare} placeholder={total ? (total / 2).toFixed(2).replace(".", ",") : "50 %"} onChange={(event) => setOwnShare(event.target.value)} /></Field> : null}
        <Field label="Zahlungsart">
          <Select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>
            <option value="cash">Bar / Kasse</option>
            <option value="card">Karte / Flatpay</option>
            <option value="bank">Bank</option>
            <option value="paypal">PayPal</option>
          </Select>
        </Field>
        <Field label="Notiz"><Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="optional" /></Field>
      </div>

      <label className="check-card">
        <input type="checkbox" checked={createReceipt} onChange={(event) => setCreateReceipt(event.target.checked)} />
        <span><strong>Quittung erstellen</strong><small>Fortlaufende QU-Nummer und Buchungsverknüpfung erzeugen.</small></span>
      </label>

      <div className="calculation-box">
        <h3>Vorschau</h3>
        <div><span>Gesamtzahlung</span><strong>{formatCurrency(total)}</strong></div>
        <div><span>{preview.firstLabel}</span><strong>{formatCurrency(preview.firstAmount)}</strong></div>
        {preview.secondLabel ? <div><span>{preview.secondLabel}</span><strong>{formatCurrency(preview.secondAmount)}</strong></div> : null}
        <div><span>Zahlungskonto</span><strong>{paymentAccountLabel(paymentMethod)}</strong></div>
        <div><span>Kassenwirkung</span><strong>{paymentMethod === "cash" ? `+${formatCurrency(total)}` : formatCurrency(0)}</strong></div>
      </div>
    </Modal>
  );
}

function serviceLabel(kind: ServiceBookingKind): string {
  return kind === "unitelTopup" ? "UniTel-Guthabenverkauf" : kind === "unitelCommission" ? "UniTel-Provision" : "Prifoto-Kundenzahlung";
}

function paymentAccountLabel(method: PaymentMethod): string {
  return ({ cash: "1000 · Kasse", card: "1360 · Flatpay/Karte", bank: "1200 · Bank", paypal: "1370 · PayPal" } as const)[method];
}
