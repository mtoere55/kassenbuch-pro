"use client";

import { useServiceAccess } from "@/lib/bookkeeping-rules";
import { OwnerAccessButton } from "../OwnerAccessButton";
import { SettingsPage } from "./SettingsPage";

export function SettingsAccessPage() {
  const { open } = useServiceAccess();
  return <>
    {!open ? <div className="alert alert-info"><strong>Inhaberbereich:</strong> Nummerierung, Änderungssperre und Wartungsfunktionen sind geschützt. <OwnerAccessButton /></div> : null}
    <SettingsPage />
  </>;
}
