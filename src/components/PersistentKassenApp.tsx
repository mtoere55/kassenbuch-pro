"use client";

import { useEffect, useRef } from "react";
import { AppShell } from "./AppShell";
import { CidGateway } from "./CidGateway";
import {
  installLocalStorageAttachmentBridge,
  loadAttachmentRecords,
  mergeStateWithBrowserAttachments,
} from "@/lib/browser-persistence";
import { repairHistoricalCashDeposits } from "@/lib/cash-deposit-repair";
import { KassenProvider, useKassenStore } from "@/lib/store";

if (typeof window !== "undefined") {
  installLocalStorageAttachmentBridge();
}

export function PersistentKassenApp() {
  return (
    <CidGateway>
      {(cidSession, logoutCid) => (
        <KassenProvider key={cidSession.cid}>
          <AttachmentHydrator />
          <AppShell cidSession={cidSession} logoutCid={logoutCid} />
        </KassenProvider>
      )}
    </CidGateway>
  );
}

function AttachmentHydrator() {
  const { state, hydrated, replaceState } = useKassenStore();
  const restored = useRef(false);

  useEffect(() => {
    if (!hydrated || restored.current) return;
    restored.current = true;
    let active = true;

    const repairedState = repairHistoricalCashDeposits(state);
    if (repairedState !== state) {
      replaceState(repairedState);
    }

    void loadAttachmentRecords()
      .then((records) => {
        if (!active || !records.length) return;
        replaceState(mergeStateWithBrowserAttachments(repairedState, records));
      })
      .catch((error) => {
        console.error("Gespeicherte Dokumentdateien konnten nicht geladen werden", error);
      });

    return () => {
      active = false;
    };
  }, [hydrated, replaceState, state]);

  return null;
}
