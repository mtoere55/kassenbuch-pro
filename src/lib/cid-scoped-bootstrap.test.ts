import { describe, expect, it } from "vitest";
import { cidStateStorageKey } from "./browser-persistence";
import {
  ensureCidScopedBootstrap,
  type BrowserStorageLike,
} from "./cid-scoped-bootstrap";

class MemoryStorage implements BrowserStorageLike {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("CID scoped bootstrap", () => {
  it("creates an explicit empty state for a new CID", () => {
    const storage = new MemoryStorage();

    ensureCidScopedBootstrap("CID-26-00007", storage);

    const saved = storage.getItem(cidStateStorageKey("CID-26-00007"));
    expect(saved).toBeTruthy();
    const state = JSON.parse(saved as string);
    expect(state.settings.businessName).toBe("Mein Betrieb");
    expect(state.settings.openingCash).toBe(0);
    expect(state.customers).toEqual([]);
    expect(state.devices).toEqual([]);
    expect(state.documents).toEqual([]);
    expect(state.ledger).toEqual([]);
  });

  it("does not overwrite an existing CID state", () => {
    const storage = new MemoryStorage();
    const key = cidStateStorageKey("CID-26-00004");
    const existing = JSON.stringify({
      version: 1,
      customers: [],
      devices: [],
      purchases: [],
      sales: [],
      documents: [],
      ledger: [],
      importedTransactions: [],
      settings: { businessName: "Handyshop Sun-Tel" },
    });
    storage.setItem(key, existing);

    ensureCidScopedBootstrap("CID-26-00004", storage);

    expect(storage.getItem(key)).toBe(existing);
  });

  it("blocks a malformed CID state instead of falling back to demo data", () => {
    const storage = new MemoryStorage();
    storage.setItem(cidStateStorageKey("CID-26-00007"), "{broken");

    expect(() => ensureCidScopedBootstrap("CID-26-00007", storage)).toThrow(
      "Datenspeicher dieses CID-Kontos ist beschädigt",
    );
  });
});
