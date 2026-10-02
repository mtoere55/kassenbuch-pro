"use client";

import {
  loadAttachmentRecords,
  saveAttachmentRecords,
  splitStateForBrowserStorage,
  type AttachmentRecord,
} from "./browser-persistence";
import type { AppState } from "./types";

const ATTACHMENT_CHUNK_BYTES = 400 * 1024;

export interface RemoteStateResult {
  exists: boolean;
  revision: number | null;
  updatedAt?: string;
  state?: AppState;
}

export interface ServerAttachmentManifestItem {
  key: string;
  size: number;
  sha256: string;
  updatedAt: string;
}

export class ServerRevisionConflictError extends Error {
  currentRevision: number | null;

  constructor(currentRevision: number | null) {
    super("Die Kassenbuch-Daten wurden bereits in einem anderen Browser geändert.");
    this.name = "ServerRevisionConflictError";
    this.currentRevision = currentRevision;
  }
}

export interface LocalServerSyncMarker {
  revision: number;
  fingerprint: string;
  syncedAt: string;
}

export type InitialServerSyncDecision = "push-local" | "use-remote" | "conflict";

export function decideInitialServerSync(input: {
  marker?: LocalServerSyncMarker;
  browserFingerprint: string;
  localFingerprint: string;
  remoteFingerprint: string;
  remoteRevision: number;
  localHasData: boolean;
}): InitialServerSyncDecision {
  const { marker } = input;

  if (marker) {
    if (marker.revision > input.remoteRevision) return "conflict";

    const hasUnsyncedLocalChanges = marker.fingerprint !== input.browserFingerprint;
    if (marker.revision < input.remoteRevision) {
      return hasUnsyncedLocalChanges ? "conflict" : "use-remote";
    }

    return hasUnsyncedLocalChanges ? "push-local" : "use-remote";
  }

  if (input.localHasData && input.localFingerprint !== input.remoteFingerprint) {
    return "conflict";
  }

  return "use-remote";
}

const SERVER_SYNC_MARKER_PREFIX = "kassenbuch-pro-server-sync-v1:";

export function readLocalServerSyncMarker(cid: string): LocalServerSyncMarker | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(`${SERVER_SYNC_MARKER_PREFIX}${cid}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<LocalServerSyncMarker>;
    if (!Number.isInteger(parsed.revision) || !parsed.fingerprint || !parsed.syncedAt) return undefined;
    return parsed as LocalServerSyncMarker;
  } catch {
    return undefined;
  }
}

export function writeLocalServerSyncMarker(cid: string, revision: number, state: AppState): void {
  if (typeof window === "undefined") return;
  const fingerprint = compactStateFingerprint(state);
  window.localStorage.setItem(
    `${SERVER_SYNC_MARKER_PREFIX}${cid}`,
    JSON.stringify({ revision, fingerprint, syncedAt: new Date().toISOString() } satisfies LocalServerSyncMarker),
  );
}

export function compactStateFingerprint(state: AppState): string {
  return fingerprint(compactStateString(state));
}

export async function fetchRemoteState(): Promise<RemoteStateResult> {
  const response = await fetch("/api/kassenbuch/state", {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
  });
  if (response.status === 404) return { exists: false, revision: null };
  const payload = await response.json() as {
    error?: string;
    revision?: number;
    updatedAt?: string;
    state?: AppState;
  };
  if (!response.ok || !payload.state || !payload.revision) {
    throw new Error(payload.error || "Serverdaten konnten nicht geladen werden.");
  }
  return {
    exists: true,
    revision: payload.revision,
    updatedAt: payload.updatedAt,
    state: payload.state,
  };
}

export async function pushRemoteState(
  state: AppState,
  baseRevision: number | null,
): Promise<{ revision: number; updatedAt: string; serialized: string }> {
  const compactState = splitStateForBrowserStorage(state).compactState;
  const serialized = JSON.stringify({
    baseRevision,
    state: compactState,
  });
  const body = await compressJson(serialized);
  const response = await fetch("/api/kassenbuch/state", {
    method: "PUT",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(body.encoding ? { "Content-Encoding": body.encoding } : {}),
    },
    body: body.bytes,
  });
  const payload = await response.json() as {
    error?: string;
    code?: string;
    currentRevision?: number | null;
    revision?: number;
    updatedAt?: string;
  };
  if (response.status === 409 || payload.code === "REVISION_CONFLICT") {
    throw new ServerRevisionConflictError(payload.currentRevision ?? null);
  }
  if (!response.ok || !payload.revision || !payload.updatedAt) {
    throw new Error(payload.error || "Serverdaten konnten nicht gespeichert werden.");
  }
  return {
    revision: payload.revision,
    updatedAt: payload.updatedAt,
    serialized: JSON.stringify(compactState),
  };
}

export function compactStateString(state: AppState): string {
  return JSON.stringify(splitStateForBrowserStorage(state).compactState);
}

export function isMeaningfulState(state: AppState): boolean {
  const businessName = state.settings.businessName.trim();
  const ownerName = state.settings.ownerName.trim();
  const hasConfiguredBusiness = Boolean(
    ownerName ||
    (businessName && businessName !== "Mein Betrieb"),
  );
  const coreRows =
    state.customers.length +
    state.devices.length +
    state.purchases.length +
    state.sales.length +
    state.ledger.length +
    state.importedTransactions.length;

  // Initial server seeding is deliberately conservative. A default browser can
  // contain one stray/generated document, but it must never become the
  // authoritative CID dataset merely because of that artifact.
  return hasConfiguredBusiness || coreRows >= 3;
}

export async function syncAttachmentsWithServer(
  cid: string,
  onProgress?: (done: number, total: number) => void,
): Promise<AttachmentRecord[]> {
  const localRecords = await loadAttachmentRecords();
  const localByKey = new Map(localRecords.map((record) => [record.key, record]));
  const manifest = await fetchAttachmentManifest();
  const serverByKey = new Map(manifest.map((item) => [item.key, item]));

  const downloads = manifest.filter((item) => !localByKey.has(item.key));
  const uploads = localRecords.filter(
    (record) => record.key.startsWith(`cid:${cid}:`) && !serverByKey.has(record.key),
  );
  const total = downloads.length + uploads.length;
  let done = 0;
  onProgress?.(done, total);

  for (const item of downloads) {
    const record = await downloadAttachment(item.key);
    await saveAttachmentRecords([record]);
    localByKey.set(record.key, record);
    done += 1;
    onProgress?.(done, total);
  }

  for (const record of uploads) {
    await uploadAttachment(record);
    done += 1;
    onProgress?.(done, total);
  }

  return [...localByKey.values()];
}

async function fetchAttachmentManifest(): Promise<ServerAttachmentManifestItem[]> {
  const response = await fetch("/api/kassenbuch/attachments", {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
  });
  const payload = await response.json() as {
    error?: string;
    items?: ServerAttachmentManifestItem[];
  };
  if (!response.ok) throw new Error(payload.error || "Server-Dokumentliste konnte nicht geladen werden.");
  return payload.items || [];
}

async function downloadAttachment(key: string): Promise<AttachmentRecord> {
  const response = await fetch(`/api/kassenbuch/attachments?key=${encodeURIComponent(key)}`, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) {
    let message = "Dokumentdatei konnte nicht vom Server geladen werden.";
    try {
      const payload = await response.json() as { error?: string };
      message = payload.error || message;
    } catch {
      // Text response was not JSON.
    }
    throw new Error(message);
  }
  return { key, value: await response.text() };
}

async function uploadAttachment(record: AttachmentRecord): Promise<void> {
  const sha256 = await sha256Text(record.value);
  const chunks = splitUtf8(record.value, ATTACHMENT_CHUNK_BYTES);
  const uploadId = createUploadId();
  for (let index = 0; index < chunks.length; index += 1) {
    const response = await fetch("/api/kassenbuch/attachments", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: record.key,
        uploadId,
        index,
        total: chunks.length,
        chunk: chunks[index],
        sha256,
      }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error || "Dokumentdatei konnte nicht auf den Server geladen werden.");
  }
}

async function sha256Text(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function splitUtf8(value: string, maxBytes: number): string[] {
  if (!value) return [""];
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let start = 0;
  while (start < value.length) {
    let end = Math.min(value.length, start + maxBytes);
    let candidate = value.slice(start, end);
    while (encoder.encode(candidate).byteLength > maxBytes && end > start + 1) {
      end = start + Math.max(1, Math.floor((end - start) * 0.8));
      candidate = value.slice(start, end);
    }
    if (end <= start) throw new Error("Dokumentdatei konnte nicht in Upload-Teile zerlegt werden.");
    chunks.push(candidate);
    start = end;
  }
  return chunks;
}

function createUploadId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID().replace(/-/g, "");
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 16)}`;
}

async function compressJson(value: string): Promise<{ bytes: BodyInit; encoding?: string }> {
  if (typeof CompressionStream === "undefined") return { bytes: value };
  const input = new Blob([value]).stream();
  const compressed = input.pipeThrough(new CompressionStream("gzip"));
  const bytes = await new Response(compressed).arrayBuffer();
  return { bytes, encoding: "gzip" };
}


function fingerprint(value: string): string {
  let hashA = 2166136261;
  let hashB = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    hashA ^= code;
    hashA = Math.imul(hashA, 16777619);
    hashB ^= code + ((hashB << 6) >>> 0) + (hashB >>> 2);
    hashB >>>= 0;
  }
  return `${value.length.toString(36)}:${(hashA >>> 0).toString(36)}:${(hashB >>> 0).toString(36)}`;
}
