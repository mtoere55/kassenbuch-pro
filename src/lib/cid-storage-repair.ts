import type { AppState } from "./types";
import {
  ACTIVE_CID_STORAGE_KEY,
  APP_STORAGE_KEY,
  cidStateStorageKey,
  createEmptyBrowserState,
  normalizeCidStorageScope,
} from "./browser-persistence";

const REPAIR_MARKER_PREFIX = "kassenbuch-pro-cid-leak-repair-v2";
const QUARANTINE_PREFIX = "kassenbuch-pro-quarantine-v2";
const ATTACHMENT_DB = "kassenbuch-pro-local-files";
const ATTACHMENT_STORE = "attachments";

export async function repairLeakedCidState(
  cid: string,
  legacyOwnerCid?: string,
): Promise<boolean> {
  if (typeof window === "undefined" || !legacyOwnerCid) return false;

  const scope = normalizeCidStorageScope(cid);
  const ownerScope = normalizeCidStorageScope(legacyOwnerCid);
  if (scope === ownerScope) return false;

  const markerKey = `${REPAIR_MARKER_PREFIX}:${scope}`;
  if (window.localStorage.getItem(markerKey) === "1") return false;

  const scopedKey = cidStateStorageKey(scope);
  const candidate = window.localStorage.getItem(scopedKey);
  const ownerState = window.localStorage.getItem(cidStateStorageKey(ownerScope));
  const legacyState = readRawLegacyState();
  const reference = ownerState || legacyState;

  if (!candidate || !reference) return false;

  const leaked = isLikelyLeakedOwnerState(candidate, reference);
  if (leaked) {
    const stamp = Date.now();
    window.localStorage.setItem(
      `${QUARANTINE_PREFIX}:${scope}:${stamp}`,
      candidate,
    );
    window.localStorage.setItem(
      scopedKey,
      JSON.stringify(createEmptyBrowserState()),
    );
    await quarantineScopedAttachments(scope, stamp);
  }

  window.localStorage.setItem(markerKey, "1");
  return leaked;
}

export function isLikelyLeakedOwnerState(
  candidateValue: string,
  ownerValue: string,
): boolean {
  if (candidateValue === ownerValue) return true;

  const candidate = parseState(candidateValue);
  const owner = parseState(ownerValue);
  if (!candidate || !owner || isEmptyState(candidate)) return false;

  const candidateSettings = candidate.settings;
  const ownerSettings = owner.settings;
  const sameBusiness = sameMeaningfulValue(
    candidateSettings?.businessName,
    ownerSettings?.businessName,
    ["mein betrieb"],
  );
  const sameTaxNumber = sameMeaningfulValue(
    candidateSettings?.taxNumber,
    ownerSettings?.taxNumber,
  );
  const sameOwner = sameMeaningfulValue(
    candidateSettings?.ownerName,
    ownerSettings?.ownerName,
  );
  const sameAddress =
    sameMeaningfulValue(candidateSettings?.street, ownerSettings?.street) &&
    sameMeaningfulValue(candidateSettings?.postalCode, ownerSettings?.postalCode) &&
    sameMeaningfulValue(candidateSettings?.city, ownerSettings?.city);

  const candidateIds = stateRecordIds(candidate);
  const ownerIds = stateRecordIds(owner);
  const sharedIds = [...candidateIds].filter((id) => ownerIds.has(id)).length;
  const highRecordOverlap =
    sharedIds > 0 &&
    sharedIds / Math.max(1, Math.min(candidateIds.size, ownerIds.size)) >= 0.8;

  return (
    highRecordOverlap ||
    (sameBusiness && (sameTaxNumber || (sameOwner && sameAddress) || sharedIds >= 2))
  );
}

function readRawLegacyState(): string | null {
  const currentScope = window.localStorage.getItem(ACTIVE_CID_STORAGE_KEY);
  try {
    window.localStorage.removeItem(ACTIVE_CID_STORAGE_KEY);
    return window.localStorage.getItem(APP_STORAGE_KEY);
  } finally {
    if (currentScope) {
      window.localStorage.setItem(ACTIVE_CID_STORAGE_KEY, currentScope);
    }
  }
}

function parseState(value: string): Partial<AppState> | undefined {
  try {
    const parsed = JSON.parse(value) as Partial<AppState>;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isEmptyState(state: Partial<AppState>): boolean {
  return [
    state.customers,
    state.devices,
    state.purchases,
    state.sales,
    state.documents,
    state.ledger,
    state.importedTransactions,
  ].every((items) => Array.isArray(items) && items.length === 0);
}

function stateRecordIds(state: Partial<AppState>): Set<string> {
  const ids = new Set<string>();
  const collections = [
    state.customers,
    state.devices,
    state.purchases,
    state.sales,
    state.documents,
    state.ledger,
    state.importedTransactions,
  ];
  for (const collection of collections) {
    if (!Array.isArray(collection)) continue;
    for (const item of collection) {
      if (item && typeof item === "object" && "id" in item) {
        const id = (item as { id?: unknown }).id;
        if (typeof id === "string" && id) ids.add(id);
      }
    }
  }
  return ids;
}

function sameMeaningfulValue(
  left: unknown,
  right: unknown,
  ignored: string[] = [],
): boolean {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  return (
    Boolean(normalizedLeft) &&
    normalizedLeft === normalizedRight &&
    !ignored.includes(normalizedLeft)
  );
}

function normalizeText(value: string): string {
  return value.trim().toLocaleLowerCase("de-DE").replace(/\s+/g, " ");
}

async function quarantineScopedAttachments(scope: string, stamp: number): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const database = await openAttachmentDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(ATTACHMENT_STORE, "readwrite");
    const store = transaction.objectStore(ATTACHMENT_STORE);
    const request = store.getAll();
    request.onsuccess = () => {
      const prefix = `cid:${scope}:`;
      for (const record of (request.result || []) as Array<{ key: string; value: string }>) {
        if (!record.key.startsWith(prefix)) continue;
        store.put({
          key: `quarantine:${scope}:${stamp}:${record.key}`,
          value: record.value,
        });
        store.delete(record.key);
      }
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

function openAttachmentDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ATTACHMENT_DB, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(ATTACHMENT_STORE)) {
        database.createObjectStore(ATTACHMENT_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
