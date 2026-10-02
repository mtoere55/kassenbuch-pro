import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { access, copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppState } from "./types";

const DEFAULT_DATA_DIR = "/opt/kassenbuch-pro/data";
const MAX_HISTORY = 100;
const stateWriteLocks = new Map<string, Promise<void>>();
const MAX_STATE_BYTES = 12 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const MAX_CHUNK_BYTES = 600 * 1024;

export interface ServerStateSnapshot {
  cid: string;
  revision: number;
  updatedAt: string;
  state: AppState;
}

export interface AttachmentManifestItem {
  key: string;
  size: number;
  sha256: string;
  updatedAt: string;
}

export interface AttachmentChunkInput {
  key: string;
  uploadId: string;
  index: number;
  total: number;
  chunk: string;
  sha256: string;
}

function dataRoot(): string {
  return process.env.KASSENBUCH_DATA_DIR?.trim() || DEFAULT_DATA_DIR;
}

function cidHash(cid: string): string {
  return createHash("sha256").update(cid, "utf8").digest("hex");
}

function keyHash(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

function cidDir(cid: string): string {
  return path.join(dataRoot(), "cid", cidHash(cid));
}

function statePath(cid: string): string {
  return path.join(cidDir(cid), "state.json");
}

function historyDir(cid: string): string {
  return path.join(cidDir(cid), "history");
}

function attachmentsDir(cid: string): string {
  return path.join(cidDir(cid), "attachments");
}

function uploadDir(cid: string, uploadId: string): string {
  return path.join(cidDir(cid), "uploads", sanitizeUploadId(uploadId));
}

export async function ensureServerStorageReady(cid: string): Promise<void> {
  const root = dataRoot();
  await mkdir(root, { recursive: true });
  await mkdir(cidDir(cid), { recursive: true });
  await mkdir(historyDir(cid), { recursive: true });
  await mkdir(attachmentsDir(cid), { recursive: true });
  await access(root);
}

export async function readServerState(cid: string): Promise<ServerStateSnapshot | undefined> {
  await ensureServerStorageReady(cid);
  try {
    const raw = await readFile(statePath(cid), "utf8");
    const parsed = JSON.parse(raw) as ServerStateSnapshot;
    if (parsed.cid !== cid || !Number.isInteger(parsed.revision) || parsed.revision < 1 || !isAppState(parsed.state)) {
      throw new Error("Ungültiger Server-Datensatz.");
    }
    return parsed;
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

export async function writeServerState(
  cid: string,
  state: AppState,
  baseRevision: number | null,
): Promise<ServerStateSnapshot> {
  return withCidStateWriteLock(cid, async () => {
    if (!isAppState(state)) throw new Error("Ungültiger Kassenbuch-Datensatz.");
    const serializedState = JSON.stringify(state);
    if (Buffer.byteLength(serializedState, "utf8") > MAX_STATE_BYTES) {
      throw new Error("Der kompakte Kassenbuch-Datensatz ist für die Serversynchronisierung zu groß.");
    }

    await ensureServerStorageReady(cid);
    const current = await readServerState(cid);
    const currentRevision = current?.revision ?? null;
    if (currentRevision !== baseRevision) {
      const conflict = new Error("SERVER_REVISION_CONFLICT");
      (conflict as Error & { currentRevision?: number | null }).currentRevision = currentRevision;
      throw conflict;
    }

    if (current) {
      const stamp = current.updatedAt.replace(/[:.]/g, "-");
      await copyFile(statePath(cid), path.join(historyDir(cid), `state-r${current.revision}-${stamp}.json`));
    }

    const next: ServerStateSnapshot = {
      cid,
      revision: (current?.revision ?? 0) + 1,
      updatedAt: new Date().toISOString(),
      state,
    };
    const target = statePath(cid);
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(next), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, target);
    await pruneHistory(cid);
    return next;
  });
}

export async function listStateHistory(cid: string): Promise<Array<{ name: string; revision: number; updatedAt: string; size: number }>> {
  await ensureServerStorageReady(cid);
  const files = await readdir(historyDir(cid));
  const rows = await Promise.all(files.filter((name) => name.endsWith(".json")).map(async (name) => {
    const info = await stat(path.join(historyDir(cid), name));
    const match = name.match(/^state-r(\d+)-(.+)\.json$/);
    return {
      name,
      revision: Number(match?.[1] || 0),
      updatedAt: info.mtime.toISOString(),
      size: info.size,
    };
  }));
  return rows.sort((a, b) => b.revision - a.revision);
}

export async function listAttachments(cid: string): Promise<AttachmentManifestItem[]> {
  await ensureServerStorageReady(cid);
  const files = await readdir(attachmentsDir(cid));
  const metadataFiles = files.filter((name) => name.endsWith(".meta.json"));
  const items: AttachmentManifestItem[] = [];
  for (const name of metadataFiles) {
    try {
      const raw = await readFile(path.join(attachmentsDir(cid), name), "utf8");
      const parsed = JSON.parse(raw) as AttachmentManifestItem;
      if (parsed.key && parsed.sha256 && Number.isFinite(parsed.size)) items.push(parsed);
    } catch {
      // Ignore one corrupt metadata file instead of blocking every attachment.
    }
  }
  return items.sort((a, b) => a.key.localeCompare(b.key));
}

export async function readAttachment(cid: string, key: string): Promise<{ item: AttachmentManifestItem; value: string } | undefined> {
  validateAttachmentKey(key);
  await ensureServerStorageReady(cid);
  const hash = keyHash(key);
  try {
    const [metaRaw, value] = await Promise.all([
      readFile(path.join(attachmentsDir(cid), `${hash}.meta.json`), "utf8"),
      readFile(path.join(attachmentsDir(cid), `${hash}.txt`), "utf8"),
    ]);
    const item = JSON.parse(metaRaw) as AttachmentManifestItem;
    if (item.key !== key) throw new Error("Attachment-Schlüssel stimmt nicht überein.");
    return { item, value };
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

export async function writeAttachmentChunk(
  cid: string,
  input: AttachmentChunkInput,
): Promise<{ complete: boolean; item?: AttachmentManifestItem }> {
  validateAttachmentKey(input.key);
  validateUpload(input);
  await ensureServerStorageReady(cid);

  const dir = uploadDir(cid, input.uploadId);
  await mkdir(dir, { recursive: true });
  const metadataPath = path.join(dir, "upload.json");
  const expectedMeta = JSON.stringify({
    key: input.key,
    total: input.total,
    sha256: input.sha256,
  });

  try {
    const existing = await readFile(metadataPath, "utf8");
    if (existing !== expectedMeta) throw new Error("Upload-ID wird bereits für eine andere Datei verwendet.");
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await writeFile(metadataPath, expectedMeta, { encoding: "utf8", mode: 0o600 });
  }

  await writeFile(path.join(dir, `${String(input.index).padStart(5, "0")}.part`), input.chunk, { encoding: "utf8", mode: 0o600 });

  const files = await readdir(dir);
  const partFiles = files.filter((name) => name.endsWith(".part")).sort();
  if (partFiles.length < input.total) return { complete: false };

  let totalBytes = 0;
  const parts: string[] = [];
  for (let index = 0; index < input.total; index += 1) {
    const filename = `${String(index).padStart(5, "0")}.part`;
    const value = await readFile(path.join(dir, filename), "utf8");
    totalBytes += Buffer.byteLength(value, "utf8");
    if (totalBytes > MAX_ATTACHMENT_BYTES) throw new Error("Dokumentdatei ist für die Serversynchronisierung zu groß.");
    parts.push(value);
  }
  const value = parts.join("");
  const actualSha = createHash("sha256").update(value, "utf8").digest("hex");
  if (actualSha !== input.sha256) throw new Error("Dokumentdatei wurde beim Upload verändert.");

  const hash = keyHash(input.key);
  const targetValue = path.join(attachmentsDir(cid), `${hash}.txt`);
  const targetMeta = path.join(attachmentsDir(cid), `${hash}.meta.json`);
  const tempValue = `${targetValue}.${randomUUID()}.tmp`;
  const tempMeta = `${targetMeta}.${randomUUID()}.tmp`;
  const item: AttachmentManifestItem = {
    key: input.key,
    size: Buffer.byteLength(value, "utf8"),
    sha256: actualSha,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(tempValue, value, { encoding: "utf8", mode: 0o600 });
  await writeFile(tempMeta, JSON.stringify(item), { encoding: "utf8", mode: 0o600 });
  await rename(tempValue, targetValue);
  await rename(tempMeta, targetMeta);
  await rm(dir, { recursive: true, force: true });
  return { complete: true, item };
}

export function isRevisionConflict(error: unknown): error is Error & { currentRevision?: number | null } {
  return error instanceof Error && error.message === "SERVER_REVISION_CONFLICT";
}

function isAppState(value: unknown): value is AppState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<AppState>;
  return (
    state.version === 1 &&
    Array.isArray(state.customers) &&
    Array.isArray(state.devices) &&
    Array.isArray(state.purchases) &&
    Array.isArray(state.sales) &&
    Array.isArray(state.documents) &&
    Array.isArray(state.ledger) &&
    Array.isArray(state.importedTransactions) &&
    Boolean(state.settings && typeof state.settings === "object")
  );
}

function validateAttachmentKey(key: string): void {
  if (!key || key.length > 260 || !/^cid:[A-Z0-9._:-]{3,120}:(document|ledger):/.test(key)) {
    throw new Error("Ungültiger Dokument-Schlüssel.");
  }
}

function validateUpload(input: AttachmentChunkInput): void {
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(input.uploadId)) throw new Error("Ungültige Upload-ID.");
  if (!Number.isInteger(input.index) || input.index < 0) throw new Error("Ungültiger Upload-Teil.");
  if (!Number.isInteger(input.total) || input.total < 1 || input.total > 64 || input.index >= input.total) throw new Error("Ungültige Upload-Anzahl.");
  if (typeof input.chunk !== "string" || Buffer.byteLength(input.chunk, "utf8") > MAX_CHUNK_BYTES) throw new Error("Upload-Teil ist zu groß.");
  if (!/^[a-f0-9]{64}$/.test(input.sha256)) throw new Error("Ungültige Prüfsumme.");
}

function sanitizeUploadId(value: string): string {
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(value)) throw new Error("Ungültige Upload-ID.");
  return value;
}

async function pruneHistory(cid: string): Promise<void> {
  const history = await listStateHistory(cid);
  const stale = history.slice(MAX_HISTORY);
  await Promise.all(stale.map((item) => rm(path.join(historyDir(cid), item.name), { force: true })));
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT");
}


async function withCidStateWriteLock<T>(cid: string, task: () => Promise<T>): Promise<T> {
  const previous = stateWriteLocks.get(cid) || Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => gate);
  stateWriteLocks.set(cid, queued);

  await previous;
  try {
    return await task();
  } finally {
    release();
    if (stateWriteLocks.get(cid) === queued) stateWriteLocks.delete(cid);
  }
}
