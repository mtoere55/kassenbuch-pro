"use client";

import { useEffect } from "react";
import { migrateKasImportSources } from "@/lib/kas-review";
import { normalizeSaleAccountingState } from "@/lib/sale-accounting-normalizer";
import { useKassenStore } from "@/lib/store";
import { LedgerPage } from "./LedgerPage";

export function LedgerImportPage() {
  const { state, replaceState } = useKassenStore();

  useEffect(() => {
    const salesNormalized = normalizeSaleAccountingState(state);
    const migrated = migrateKasImportSources(salesNormalized);
    if (migrated !== state) replaceState(migrated);
  }, [replaceState, state]);

  return <LedgerPage />;
}
