import type { AppState } from "./types";

export const APP_STORAGE_KEY = "kassenbuch-pro-state-v1";
export const ACTIVE_CID_STORAGE_KEY = "kassenbuch-pro-active-cid-v1";
export const DATA_OWNER_CID_KEY = "kassenbuch-pro-data-owner-cid-v1";
export const CONFIGURED_LEGACY_OWNER_CID_KEY = "kassenbuch-pro-configured-legacy-owner-cid-v1";

const DB_NAME = "kassenbuch-pro-local-files";
const DB_VERSION = 1;
const STORE_NAME = "attachments";
const BRIDGE_FLAG = "__kassenbuchStorageBridgeInstalled";
const CID_ATTACHMENT_PREFIX = "cid:";
const QUARANTINE_PREFIX = "kassenbuch-pro-quarantine-v1";

let originalStorageGetItem: typeof Storage.prototype.getItem | undefined;
let originalStorageSetItem: typeof Storage.prototype.setItem | undefined;

export interface AttachmentRecord {
  key: string;
  value: string;
}

export interface SplitStateResult {
  compactState: AppState;
  attachments: AttachmentRecord[];
}

export interface CidStorageActivation {
  changed: boolean;
  migratedLegacyState: boolean;
  repairedMisassignedState: boolean;
  scope: string;
}

declare global {
  interface Window {
    __kassenbuchStorageBridgeInstalled?: boolean;
  }
}

export function normalizeCidStorageScope(cid: string): string {
  const normalized = cid.trim().toUpperCase().replace(/[^A-Z0-9._:-]/g, "");
  if (!/^[A-Z0-9._:-]{3,120}$/.test(normalized)) {
    throw new Error("Ungültige CID für den lokalen Datenspeicher.");
  }
  return normalized;
}

export function cidStateStorageKey(cid: string): string {
  return `${APP_STORAGE_KEY}:${normalizeCidStorageScope(cid)}`;
}

export function createEmptyBrowserState(): AppState {
  return {
    version: 1,
    customers: [],
    devices: [],
    purchases: [],
    sales: [],
    documents: [],
    ledger: [],
    importedTransactions: [],
    settings: {
      businessName: "Mein Betrieb",
      ownerName: "",
      street: "",
      postalCode: "",
      city: "",
      phone: "",
      email: "",
      taxNumber: "",
      vatId: "",
      iban: "",
      invoicePrefix: "RE",
      receiptPrefix: "QU",
      purchasePrefix: "ANK",
      currency: "EUR",
      language: "de",
      openingCash: 0,
    },
  };
}

export function activateCidStorageScope(
  cid: string,
  legacyOwnerCid?: string,
): CidStorageActivation {
  const scope = normalizeCidStorageScope(cid);
  if (typeof window === "undefined") {
    return {
      changed: false,
      migratedLegacyState: false,
      repairedMisassignedState: false,
      scope,
    };
  }

  const configuredOwner = legacyOwnerCid
    ? normalizeCidStorageScope(legacyOwnerCid)
    : undefined;
  const previousScope = rawGetItem(window.localStorage, ACTIVE_CID_STORAGE_KEY);
  const scopedKey = cidStateStorageKey(scope);
  const existingScopedState = rawGetItem(window.localStorage, scopedKey);
  const legacyState = rawGetItem(window.localStorage, APP_STORAGE_KEY);
  const dataOwner = rawGetItem(window.localStorage, DATA_OWNER_CID_KEY);
  let migratedLegacyState = false;
  let repairedMisassignedState = false;

  if (configuredOwner) {
    rawSetItem(
      window.localStorage,
      CONFIGURED_LEGACY_OWNER_CID_KEY,
      configuredOwner,
    );

    if (scope === configuredOwner) {
      if (
        legacyState &&
        (!existingScopedState || isEmptyStoredState(existingScopedState))
      ) {
        rawSetItem(window.localStorage, scopedKey, legacyState);
        migratedLegacyState = true;
      }
      rawSetItem(window.localStorage, DATA_OWNER_CID_KEY, configuredOwner);
    } else {
      const looksMisassigned = Boolean(
        existingScopedState &&
          (dataOwner === scope || existingScopedState === legacyState),
      );
      if (looksMisassigned && existingScopedState) {
        const quarantineKey = `${QUARANTINE_PREFIX}:${scope}:${Date.now()}`;
        rawSetItem(window.localStorage, quarantineKey, existingScopedState);
        rawSetItem(
          window.localStorage,
          scopedKey,
          JSON.stringify(createEmptyBrowserState()),
        );
        repairedMisassignedState = true;
      }
      rawSetItem(window.localStorage, DATA_OWNER_CID_KEY, configuredOwner);
    }
  } else if (
    !existingScopedState &&
    legacyState &&
    dataOwner === scope
  ) {
    rawSetItem(window.localStorage, scopedKey, legacyState);
    migratedLegacyState = true;
  }

  rawSetItem(window.localStorage, ACTIVE_CID_STORAGE_KEY, scope);
  return {
    changed: previousScope !== scope || repairedMisassignedState,
    migratedLegacyState,
    repairedMisassignedState,
    scope,
  };
}

export function clearCidStorageScope(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ACTIVE_CID_STORAGE_KEY);
}

export function activeCidStorageScope(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const value = rawGetItem(window.localStorage, ACTIVE_CID_STORAGE_KEY);
  return value || undefined;
}

export function splitStateForBrowserStorage(state: AppState): SplitStateResult {
  const attachments: AttachmentRecord[] = [];
  const documentData = new Map<string, string>();

  const documents = state.documents.map((document) => {
    if (document.originalImageDataUrl) {
      const key = documentDataKey(document.id);
      attachments.push({ key, value: document.originalImageDataUrl });
      documentData.set(document.id, document.originalImageDataUrl);
    }
    if (document.ocrText) {
      attachments.push({ key: documentOcrKey(document.id), value: document.ocrText });
    }
    return {
      ...document,
      originalImageDataUrl: undefined,
      ocrText: undefined,
    };
  });

  const ledger = state.ledger.map((entry) => {
    if (entry.attachmentDataUrl) {
      const sameAsDocument =
        entry.documentId && documentData.get(entry.documentId) === entry.attachmentDataUrl;
      if (!sameAsDocument) {
        attachments.push({ key: ledgerDataKey(entry.id), value: entry.attachmentDataUrl });
      }
    }
    return {
      ...entry,
      attachmentDataUrl: undefined,
    };
  });

  return {
    compactState: {
      ...state,
      documents,
      ledger,
    },
    attachments,
  };
}

export function mergeStateWithBrowserAttachments(
  compactState: AppState,
  records: AttachmentRecord[],
): AppState {
  if (!records.length) return compactState;
  const values = new Map(records.map((record) => [record.key, record.value]));

  const documents = compactState.documents.map((document) => ({
    ...document,
    originalImageDataUrl:
      document.originalImageDataUrl || values.get(documentDataKey(document.id)),
    ocrText: document.ocrText || values.get(documentOcrKey(document.id)),
  }));
  const documentData = new Map(
    documents
      .filter((document) => Boolean(document.originalImageDataUrl))
      .map((document) => [document.id, document.originalImageDataUrl as string]),
  );

  const ledger = compactState.ledger.map((entry) => ({
    ...entry,
    attachmentDataUrl:
      entry.attachmentDataUrl ||
      values.get(ledgerDataKey(entry.id)) ||
      (entry.documentId ? documentData.get(entry.documentId) : undefined),
  }));

  return { ...compactState, documents, ledger };
}

export function installLocalStorageAttachmentBridge(): void {
  if (typeof window === "undefined" || window[BRIDGE_FLAG]) return;
  window[BRIDGE_FLAG] = true;

  originalStorageGetItem = Storage.prototype.getItem;
  originalStorageSetItem = Storage.prototype.setItem;

  Storage.prototype.getItem = function patchedGetItem(key: string): string | null {
    if (this === window.localStorage && key === APP_STORAGE_KEY) {
      const scope = rawGetItem(this, ACTIVE_CID_STORAGE_KEY);
      if (scope) {
        const scopedKey = cidStateStorageKey(scope);
        const scopedState = rawGetItem(this, scopedKey);
        if (scopedState) return scopedState;

        const legacyState = rawGetItem(this, APP_STORAGE_KEY);
        const dataOwner = rawGetItem(this, DATA_OWNER_CID_KEY);
        if (legacyState && dataOwner === scope) {
          rawSetItem(this, scopedKey, legacyState);
          return legacyState;
        }

        return JSON.stringify(createEmptyBrowserState());
      }

      return rawGetItem(this, APP_STORAGE_KEY) || JSON.stringify(createEmptyBrowserState());
    }
    return rawGetItem(this, key);
  };

  Storage.prototype.setItem = function patchedSetItem(key: string, value: string): void {
    if (this === window.localStorage && key === APP_STORAGE_KEY) {
      try {
        const parsed = JSON.parse(value) as AppState;
        const { compactState, attachments } = splitStateForBrowserStorage(parsed);
        const scope = rawGetItem(this, ACTIVE_CID_STORAGE_KEY);
        const targetKey = scope ? cidStateStorageKey(scope) : APP_STORAGE_KEY;
        rawSetItem(this, targetKey, JSON.stringify(compactState));
        if (attachments.length) {
          void saveAttachmentRecords(attachments).catch((error) => {
            console.error("Dokumentdateien konnten nicht in IndexedDB gespeichert werden", error);
          });
        }
        return;
      } catch (error) {
        if (isQuotaError(error)) {
          console.error("Lokaler Speicher ist trotz Dateiauslagerung voll", error);
        }
        throw error;
      }
    }
    rawSetItem(this, key, value);
  };
}

export async function loadAttachmentRecords(): Promise<AttachmentRecord[]> {
  if (typeof indexedDB === "undefined") return [];
  const database = await openDatabase();
  const records = await new Promise<AttachmentRecord[]>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve((request.result || []) as AttachmentRecord[]);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });

  const scope = activeCidStorageScope();
  if (!scope) return records.filter((record) => isLegacyAttachmentKey(record.key));

  const prefix = cidAttachmentPrefix(scope);
  const scopedRecords = records.filter((record) => record.key.startsWith(prefix));
  if (scopedRecords.length) return scopedRecords;

  const dataOwner = rawGetItem(window.localStorage, DATA_OWNER_CID_KEY);
  if (dataOwner !== scope) return [];

  const legacyRecords = records.filter((record) => isLegacyAttachmentKey(record.key));
  if (!legacyRecords.length) return [];

  const migratedRecords = legacyRecords.map((record) => ({
    ...record,
    key: `${prefix}${record.key}`,
  }));
  await saveAttachmentRecords(migratedRecords);
  return migratedRecords;
}

export async function saveAttachmentRecords(records: AttachmentRecord[]): Promise<void> {
  if (typeof indexedDB === "undefined" || !records.length) return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    records.forEach((record) => store.put(record));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  database.close();
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function rawGetItem(storage: Storage, key: string): string | null {
  const getter = originalStorageGetItem || Storage.prototype.getItem;
  return getter.call(storage, key);
}

function rawSetItem(storage: Storage, key: string, value: string): void {
  const setter = originalStorageSetItem || Storage.prototype.setItem;
  setter.call(storage, key, value);
}

function cidAttachmentPrefix(scope = activeCidStorageScope()): string {
  return scope ? `${CID_ATTACHMENT_PREFIX}${normalizeCidStorageScope(scope)}:` : "";
}

function documentDataKey(documentId: string): string {
  return `${cidAttachmentPrefix()}document:${documentId}:data`;
}

function documentOcrKey(documentId: string): string {
  return `${cidAttachmentPrefix()}document:${documentId}:ocr`;
}

function ledgerDataKey(ledgerId: string): string {
  return `${cidAttachmentPrefix()}ledger:${ledgerId}:data`;
}

function isLegacyAttachmentKey(key: string): boolean {
  return key.startsWith("document:") || key.startsWith("ledger:");
}

function isEmptyStoredState(value: string): boolean {
  try {
    const state = JSON.parse(value) as Partial<AppState>;
    return (
      Array.isArray(state.customers) && state.customers.length === 0 &&
      Array.isArray(state.devices) && state.devices.length === 0 &&
      Array.isArray(state.purchases) && state.purchases.length === 0 &&
      Array.isArray(state.sales) && state.sales.length === 0 &&
      Array.isArray(state.documents) && state.documents.length === 0 &&
      Array.isArray(state.ledger) && state.ledger.length === 0 &&
      Array.isArray(state.importedTransactions) && state.importedTransactions.length === 0
    );
  } catch {
    return false;
  }
}

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException &&
    (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED");
}
