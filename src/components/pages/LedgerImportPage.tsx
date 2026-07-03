"use client";

import { useEffect, useState } from "react";
import { migrateKasImportSources } from "@/lib/kas-review";
import { useKassenStore } from "@/lib/store";
import { Button } from "../ui";
import { KasImportModal } from "./KasImportModal";
import { LedgerPage } from "./LedgerPage";

export function LedgerImportPage() {
  const { state, replaceState } = useKassenStore();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const migrated = migrateKasImportSources(state);
    if (migrated !== state) replaceState(migrated);
  }, [replaceState, state]);

  return <>
    <div className="booking-shortcuts">
      <Button variant="secondary" onClick={() => setOpen(true)}>KAS-Backup importieren</Button>
    </div>
    {notice ? <div className="alert alert-success">{notice}</div> : null}
    <LedgerPage />
    <KasImportModal open={open} onClose={() => setOpen(false)} onImported={setNotice} />
  </>;
}
