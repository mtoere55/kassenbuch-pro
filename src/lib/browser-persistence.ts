import type { AppState } from "./types";

export const APP_STORAGE_KEY = "kassenbuch-pro-state-v1";

const DB_NAME = "kassenbuch-pro-local-files";
const DB_VERSION = 1;
const STORE_NAME = "attachments";
const BRIDGE_FLAG = "__kassenbuchStorageBridgeInstalled";

export interface AttachmentRecord {
  key: string;
  value: string;
}

export interface SplitStateResult {
  compactState: AppState;
  attachments: AttachmentRecord[];
}

declare global {
  interface Window {
    __kassenbuchStorageBridgeInstalled?: boolean;
  }
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

  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function patchedSetItem(key: string, value: string): void {
    if (this === window.localStorage && key === APP_STORAGE_KEY) {
      try {
        const parsed = JSON.parse(value) as AppState;
        const { compactState, attachments } = splitStateForBrowserStorage(parsed);
        originalSetItem.call(this, key, JSON.stringify(compactState));
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
    originalSetItem.call(this, key, value);
  };
}

export async function loadAttachmentRecords(): Promise<AttachmentRecord[]> {
  if (typeof indexedDB === "undefined") return [];
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
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

function documentDataKey(documentId: string): string {
  return `document:${documentId}:data`;
}

function documentOcrKey(documentId: string): string {
  return `document:${documentId}:ocr`;
}

function ledgerDataKey(ledgerId: string): string {
  return `ledger:${ledgerId}:data`;
}

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException &&
    (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED");
}
