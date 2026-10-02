"use client";

import { AppShell } from "./AppShell";
import { CidGateway } from "./CidGateway";
import { CidServerSynchronizer } from "./CidServerSynchronizer";
import { installLocalStorageAttachmentBridge } from "@/lib/browser-persistence";
import { KassenProvider } from "@/lib/store";

if (typeof window !== "undefined") {
  installLocalStorageAttachmentBridge();
}

export function PersistentKassenApp() {
  return (
    <CidGateway>
      {(cidSession, logoutCid) => (
        <KassenProvider key={cidSession.cid}>
          <CidServerSynchronizer cid={cidSession.cid} />
          <AppShell cidSession={cidSession} logoutCid={logoutCid} />
        </KassenProvider>
      )}
    </CidGateway>
  );
}
