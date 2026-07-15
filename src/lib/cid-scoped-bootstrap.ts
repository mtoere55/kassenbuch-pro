import {
  cidStateStorageKey,
  createEmptyBrowserState,
} from "./browser-persistence";

export interface BrowserStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Creates an explicit empty state for a new CID before KassenProvider mounts.
 * This prevents the store's historical demo bootstrap from ever becoming the
 * visible or persisted fallback for a verified CID.
 */
export function ensureCidScopedBootstrap(
  cid: string,
  storage?: BrowserStorageLike,
): void {
  const target = storage ?? browserStorage();
  const key = cidStateStorageKey(cid);
  const existing = target.getItem(key);

  if (!existing) {
    target.setItem(key, JSON.stringify(createEmptyBrowserState()));
    return;
  }

  try {
    const parsed = JSON.parse(existing) as {
      settings?: unknown;
      customers?: unknown;
      devices?: unknown;
      purchases?: unknown;
      sales?: unknown;
      documents?: unknown;
      ledger?: unknown;
      importedTransactions?: unknown;
    };
    const valid =
      parsed &&
      typeof parsed === "object" &&
      parsed.settings &&
      Array.isArray(parsed.customers) &&
      Array.isArray(parsed.devices) &&
      Array.isArray(parsed.purchases) &&
      Array.isArray(parsed.sales) &&
      Array.isArray(parsed.documents) &&
      Array.isArray(parsed.ledger) &&
      Array.isArray(parsed.importedTransactions);
    if (!valid) throw new Error("invalid state shape");
  } catch {
    throw new Error(
      "Der lokale Datenspeicher dieses CID-Kontos ist beschädigt. Bitte keine Daten löschen und den Support kontaktieren.",
    );
  }
}

function browserStorage(): BrowserStorageLike {
  if (typeof window === "undefined") {
    throw new Error("Der lokale CID-Datenspeicher ist im Browser nicht verfügbar.");
  }

  try {
    const probe = "__kassenbuch-cid-storage-probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    throw new Error(
      "Der Browser blockiert den lokalen CID-Datenspeicher. Bitte lokalen Speicher für diese Website erlauben.",
    );
  }
}
