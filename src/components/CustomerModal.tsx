"use client";

import { useState } from "react";
import { useKassenStore } from "@/lib/store";
import type { Customer } from "@/lib/types";
import { Button, Field, Input, Modal, Select } from "./ui";

export function CustomerModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (customer: Customer) => void;
}) {
  const { addCustomer } = useKassenStore();
  const [type, setType] = useState<Customer["type"]>("private");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [street, setStreet] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("Hagen");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [vatId, setVatId] = useState("");
  const [error, setError] = useState("");

  function reset() {
    setType("private");
    setFirstName("");
    setLastName("");
    setCompany("");
    setStreet("");
    setPostalCode("");
    setCity("Hagen");
    setPhone("");
    setEmail("");
    setVatId("");
    setError("");
  }

  function close() {
    reset();
    onClose();
  }

  function submit() {
    if (!firstName.trim() && !company.trim()) {
      setError("Bitte Namen oder Firma angeben.");
      return;
    }
    const customer = addCustomer({
      type,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      company: company.trim() || undefined,
      street: street.trim() || undefined,
      postalCode: postalCode.trim() || undefined,
      city: city.trim() || undefined,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      vatId: vatId.trim() || undefined,
      roles: ["customer", "supplier"],
    });
    onCreated?.(customer);
    close();
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Neuen Kunden anlegen"
      footer={
        <>
          <Button variant="secondary" onClick={close}>Abbrechen</Button>
          <Button onClick={submit}>Kunde speichern</Button>
        </>
      }
    >
      {error ? <div className="alert alert-danger">{error}</div> : null}
      <div className="form-grid two">
        <Field label="Kundentyp">
          <Select value={type} onChange={(event) => setType(event.target.value as Customer["type"])}>
            <option value="private">Privatkunde</option>
            <option value="business">Geschäftskunde</option>
          </Select>
        </Field>
        {type === "business" ? (
          <Field label="Firma"><Input value={company} onChange={(event) => setCompany(event.target.value)} /></Field>
        ) : <div />}
        <Field label="Vorname"><Input value={firstName} onChange={(event) => setFirstName(event.target.value)} /></Field>
        <Field label="Nachname"><Input value={lastName} onChange={(event) => setLastName(event.target.value)} /></Field>
        <Field label="Straße"><Input value={street} onChange={(event) => setStreet(event.target.value)} /></Field>
        <Field label="PLZ"><Input value={postalCode} onChange={(event) => setPostalCode(event.target.value)} /></Field>
        <Field label="Ort"><Input value={city} onChange={(event) => setCity(event.target.value)} /></Field>
        <Field label="Telefon"><Input value={phone} onChange={(event) => setPhone(event.target.value)} /></Field>
        <Field label="E-Mail"><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
        {type === "business" ? (
          <Field label="USt-IdNr."><Input value={vatId} onChange={(event) => setVatId(event.target.value)} /></Field>
        ) : null}
      </div>
    </Modal>
  );
}
