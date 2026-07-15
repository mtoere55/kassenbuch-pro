"use client";

import { useEffect } from "react";
import { migrateKasImportSources } from "@/lib/kas-review";
import { useKassenStore } from "@/lib/store";
import { LedgerPage } from "./LedgerPage";

export function LedgerImportPage() {
  const { state, replaceState } = useKassenStore();

  useEffect(() => {
    const migrated = migrateKasImportSources(state);
    if (migrated !== state) replaceState(migrated);
  }, [replaceState, state]);

  return <LedgerPage />;
}
