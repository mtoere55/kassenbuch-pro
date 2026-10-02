"use client";

import { useEffect, useRef, useState } from "react";
import {
  loadAttachmentRecords,
  mergeStateWithBrowserAttachments,
} from "@/lib/browser-persistence";
import { ensureApril2026OpeningCash } from "@/lib/cash-opening-balance";
import { repairHistoricalCashDeposits } from "@/lib/cash-deposit-repair";
import {
  compactStateFingerprint,
  compactStateString,
  decideInitialServerSync,
  fetchRemoteState,
  isMeaningfulState,
  pushRemoteState,
  readLocalServerSyncMarker,
  ServerRevisionConflictError,
  syncAttachmentsWithServer,
  writeLocalServerSyncMarker,
} from "@/lib/server-sync-client";
import { useKassenStore } from "@/lib/store";
import type { AppState } from "@/lib/types";

type SyncPhase = "loading" | "syncing" | "synced" | "local-only" | "conflict" | "error";

export function CidServerSynchronizer({ cid }: { cid: string }) {
  const { state, hydrated, replaceState } = useKassenStore();
  const [phase, setPhase] = useState<SyncPhase>("loading");
  const [detail, setDetail] = useState("CID-Server wird geprüft …");
  const initialized = useRef(false);
  const ready = useRef(false);
  const blocked = useRef(false);
  const revision = useRef<number | null>(null);
  const lastSyncedCompact = useRef("");
  const stateRef = useRef(state);
  const autosyncTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!hydrated || initialized.current) return;
    initialized.current = true;
    let active = true;

    async function initialize() {
      try {
        setPhase("syncing");
        setDetail("Lokale CID-Daten werden vorbereitet …");

        const browserState = stateRef.current;
        const browserFingerprint = compactStateFingerprint(browserState);
        const repaired = repairForCurrentRules(browserState);
        const localAttachments = await loadAttachmentRecords();
        const localState = mergeStateWithBrowserAttachments(repaired, localAttachments);
        stateRef.current = localState;
        if (active) replaceState(localState);

        setDetail("CID-Serverdaten werden geladen …");
        const remote = await fetchRemoteState();

        let canonical: AppState;
        if (remote.exists && remote.state && remote.revision) {
          const remoteCanonical = repairForCurrentRules(remote.state);
          const marker = readLocalServerSyncMarker(cid);
          const localFingerprint = compactStateFingerprint(localState);
          const remoteFingerprint = compactStateFingerprint(remoteCanonical);
          const localHasData = isMeaningfulState(localState);
          const decision = decideInitialServerSync({
            marker,
            browserFingerprint,
            localFingerprint,
            remoteFingerprint,
            remoteRevision: remote.revision,
            localHasData,
          });

          if (decision === "push-local") {
            setDetail("Nicht übertragene lokale Änderungen werden zuerst auf dem CID-Server gesichert …");
            const saved = await pushRemoteState(localState, remote.revision);
            revision.current = saved.revision;
            lastSyncedCompact.current = compactStateString(localState);
            writeLocalServerSyncMarker(cid, saved.revision, localState);
            canonical = localState;
          } else if (decision === "conflict") {
            throw new ServerRevisionConflictError(remote.revision);
          } else {
            if (marker && marker.revision < remote.revision) {
              setDetail("Neuere CID-Serverdaten werden automatisch übernommen …");
            }
            canonical = remoteCanonical;
            revision.current = remote.revision;
            lastSyncedCompact.current = compactStateString(remote.state);
            writeLocalServerSyncMarker(cid, remote.revision, remoteCanonical);
            if (active) {
              replaceState(mergeStateWithBrowserAttachments(canonical, localAttachments));
            }
          }
        } else if (isMeaningfulState(localState)) {
          setDetail("Dieser Browser überträgt den vorhandenen Datenbestand erstmals auf den CID-Server …");
          const saved = await pushRemoteState(localState, null);
          revision.current = saved.revision;
          lastSyncedCompact.current = compactStateString(localState);
          writeLocalServerSyncMarker(cid, saved.revision, localState);
          canonical = localState;
        } else {
          canonical = localState;
          revision.current = null;
          lastSyncedCompact.current = compactStateString(localState);
          ready.current = true;
          if (active) {
            setPhase("local-only");
            setDetail("Auf dem CID-Server existiert noch kein Datenbestand. Ein leerer Browser überschreibt nichts.");
          }
          return;
        }

        ready.current = true;
        if (!active) return;

        setDetail("Dokumentdateien werden zwischen Browser und CID-Server abgeglichen …");
        const syncedAttachments = await syncAttachmentsWithServer(cid, (done, total) => {
          if (!active || total === 0) return;
          setDetail(`Dokumentdateien werden synchronisiert: ${done}/${total}`);
        });

        if (!active) return;
        const latestCanonical = repairForCurrentRules(canonical);
        const withAttachments = mergeStateWithBrowserAttachments(latestCanonical, syncedAttachments);
        stateRef.current = withAttachments;
        replaceState(withAttachments);
        setPhase("synced");
        setDetail(`CID-Server aktiv · Revision ${revision.current ?? 1}`);
      } catch (cause) {
        if (!active) return;
        blocked.current = cause instanceof ServerRevisionConflictError;
        setPhase(blocked.current ? "conflict" : "error");
        setDetail(
          cause instanceof ServerRevisionConflictError
            ? "Lokale, noch nicht synchronisierte Änderungen und neuere CID-Serverdaten sind gleichzeitig vorhanden. Es wird nichts überschrieben."
            : cause instanceof Error
              ? cause.message
              : "CID-Serversynchronisierung ist fehlgeschlagen. Lokale Daten bleiben erhalten.",
        );
      }
    }

    void initialize();
    return () => {
      active = false;
      if (autosyncTimer.current) window.clearTimeout(autosyncTimer.current);
    };
  }, [cid, hydrated, replaceState]);

  useEffect(() => {
    if (phase !== "local-only") return;
    const timer = window.setInterval(() => {
      void fetchRemoteState()
        .then((remote) => {
          if (remote.exists) window.location.reload();
        })
        .catch(() => {
          // Keep the local browser usable while the server is unavailable.
        });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (!hydrated || !ready.current || blocked.current) return;
    const compact = compactStateString(state);
    if (compact === lastSyncedCompact.current) return;
    if (autosyncTimer.current) window.clearTimeout(autosyncTimer.current);

    setPhase("syncing");
    setDetail("Änderungen werden auf dem CID-Server gespeichert …");
    autosyncTimer.current = window.setTimeout(() => {
      void saveCurrentState(state);
    }, 1200);

    async function saveCurrentState(nextState: AppState) {
      try {
        const saved = await pushRemoteState(nextState, revision.current);
        revision.current = saved.revision;
        lastSyncedCompact.current = compactStateString(nextState);
        writeLocalServerSyncMarker(cid, saved.revision, nextState);
        if (revision.current) {
          setPhase("synced");
          setDetail(`CID-Server gespeichert · Revision ${revision.current}`);
        }

        window.setTimeout(() => {
          void syncAttachmentsWithServer(cid).catch((error) => {
            console.error("Dokumentdateien konnten nicht zum CID-Server synchronisiert werden", error);
            setPhase("error");
            setDetail(error instanceof Error ? error.message : "Dokument-Synchronisierung ist fehlgeschlagen.");
          });
        }, 600);
      } catch (cause) {
        if (cause instanceof ServerRevisionConflictError) {
          blocked.current = true;
          setPhase("conflict");
          setDetail("Ein anderer Browser hat neuere Daten gespeichert. Bitte diese Seite neu laden; es wird nichts überschrieben.");
          return;
        }
        setPhase("error");
        setDetail(
          cause instanceof Error
            ? `${cause.message} Lokale Daten bleiben weiterhin im Browser gespeichert.`
            : "Server-Speicherung ist fehlgeschlagen. Lokale Daten bleiben erhalten.",
        );
      }
    }

    return () => {
      if (autosyncTimer.current) window.clearTimeout(autosyncTimer.current);
    };
  }, [cid, hydrated, state]);

  return (
    <div className={`cid-server-sync cid-server-sync-${phase}`} role="status" title={detail}>
      <span className="cid-server-sync-dot" aria-hidden="true" />
      <div>
        <strong>{syncTitle(phase)}</strong>
        <small>{detail}</small>
      </div>
      {phase === "conflict" ? (
        <button type="button" onClick={() => window.location.reload()}>Neu laden</button>
      ) : null}
    </div>
  );
}

function repairForCurrentRules(state: AppState): AppState {
  return ensureApril2026OpeningCash(repairHistoricalCashDeposits(state));
}

function syncTitle(phase: SyncPhase): string {
  if (phase === "synced") return "CID-Server gesichert";
  if (phase === "syncing" || phase === "loading") return "CID-Server synchronisiert";
  if (phase === "local-only") return "Lokale Daten geschützt";
  if (phase === "conflict") return "Synchronisierung angehalten";
  return "Server-Sync prüfen";
}
