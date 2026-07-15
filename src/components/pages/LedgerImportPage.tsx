"use client";

import { useEffect, useState } from "react";
import { migrateKasImportSources } from "@/lib/kas-review";
import { normalizeSaleAccountingState } from "@/lib/sale-accounting-normalizer";
import { useKassenStore } from "@/lib/store";
import { Button } from "../ui";
import { LedgerPage } from "./LedgerPage";
import { ServiceBookingModal } from "./ServiceBookingModal";

export function LedgerImportPage() {
  const { state, replaceState } = useKassenStore();
  const [serviceOpen, setServiceOpen] = useState(false);
  const [serviceNotice, setServiceNotice] = useState("");

  useEffect(() => {
    const salesNormalized = normalizeSaleAccountingState(state);
    const migrated = migrateKasImportSources(salesNormalized);
    if (migrated !== state) replaceState(migrated);
  }, [replaceState, state]);

  return <>
    <div className="alert alert-info">
      <strong>Direkte Servicebuchung:</strong> UniTel-Guthaben, Unitel-Provision und Prifoto-50/50-Zahlungen werden automatisch zwischen Kasse, Clearing und Provision aufgeteilt. <Button variant="secondary" onClick={() => setServiceOpen(true)}>Guthaben / Prifoto buchen</Button>
    </div>
    {serviceNotice ? <div className="alert alert-success">{serviceNotice}</div> : null}
    <LedgerPage />
    <ServiceBookingModal open={serviceOpen} onClose={() => setServiceOpen(false)} onSaved={setServiceNotice} />
  </>;
}
