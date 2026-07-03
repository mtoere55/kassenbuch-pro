"use client";

import { useState } from "react";
import { Button } from "../ui";
import { KasImportModal } from "./KasImportModal";
import { LedgerPage } from "./LedgerPage";

export function LedgerImportPage() {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");

  return <>
    <div className="booking-shortcuts">
      <Button variant="secondary" onClick={() => setOpen(true)}>KAS-Backup importieren</Button>
    </div>
    {notice ? <div className="alert alert-success">{notice}</div> : null}
    <LedgerPage />
    <KasImportModal open={open} onClose={() => setOpen(false)} onImported={setNotice} />
  </>;
}
