"use client";

import { useEffect, useRef } from "react";
import { AppShell } from "./AppShell";
import {
  installLocalStorageAttachmentBridge,
  loadAttachmentRecords,
  mergeStateWithBrowserAttachments,
} from "@/lib/browser-persistence";
import { applyOfficialRecordNumbers } from "@/lib/bookkeeping-rules";
import { KassenProvider, useKassenStore } from "@/lib/store";

if (typeof window !== "undefined") {
  installLocalStorageAttachmentBridge();
}

export function PersistentKassenApp() {
  return (
    <KassenProvider>
      <AttachmentHydrator />
      <OfficialNumberingBridge />
      <AppShell />
    </KassenProvider>
  );
}

function AttachmentHydrator() {
  const { state, hydrated, replaceState } = useKassenStore();
  const restored = useRef(false);

  useEffect(() => {
    if (!hydrated || restored.current) return;
    restored.current = true;
    let active = true;

    void loadAttachmentRecords()
      .then((records) => {
        if (!active || !records.length) return;
        replaceState(mergeStateWithBrowserAttachments(state, records));
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

function OfficialNumberingBridge() {
  const { state, hydrated, replaceState } = useKassenStore();

  useEffect(() => {
    if (!hydrated) return;
    const numbered = applyOfficialRecordNumbers(state);
    if (numbered !== state) replaceState(numbered);
  }, [hydrated, replaceState, state]);

  return null;
}
