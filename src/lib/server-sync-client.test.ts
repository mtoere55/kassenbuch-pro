import { describe, expect, it } from "vitest";
import { createEmptyBrowserState } from "./browser-persistence";
import { decideInitialServerSync, isMeaningfulState } from "./server-sync-client";

describe("initial CID server seed safety", () => {
  it("does not treat a default browser with a stray document as authoritative", () => {
    const state = createEmptyBrowserState();
    state.documents.push({
      id: "doc-stray",
      documentNumber: "TMP-1",
      type: "zReport",
      date: "2026-10-02",
      amount: 0,
      taxAmount: 0,
      taxMode: "taxFree",
      status: "archived",
      createdAt: "2026-10-02T10:00:00.000Z",
    });
    expect(isMeaningfulState(state)).toBe(false);
  });

  it("accepts a configured business profile as a valid initial server seed", () => {
    const state = createEmptyBrowserState();
    state.settings.businessName = "Suntel Handy Shop";
    state.settings.ownerName = "Ali Sun";
    expect(isMeaningfulState(state)).toBe(true);
  });

  it("accepts an established operational dataset even before business settings are complete", () => {
    const state = createEmptyBrowserState();
    state.customers = [
      { id: "c1", customerNumber: "KD-1", type: "private", firstName: "A", lastName: "B", roles: ["customer"], createdAt: "2026-10-02T10:00:00.000Z" },
    ];
    state.importedTransactions = [
      { id: "i1", accountType: "bank", date: "2026-10-01", amount: 10, description: "A", matchConfidence: 0, status: "new", createdAt: "2026-10-02T10:00:00.000Z" },
      { id: "i2", accountType: "bank", date: "2026-10-02", amount: 20, description: "B", matchConfidence: 0, status: "new", createdAt: "2026-10-02T10:00:00.000Z" },
    ];
    expect(isMeaningfulState(state)).toBe(true);
  });
});


describe("initial CID server revision decisions", () => {
  const marker = {
    revision: 10,
    fingerprint: "synced-browser-state",
    syncedAt: "2026-10-02T10:00:00.000Z",
  };

  it("automatically accepts a newer server revision when the browser has no unsynced changes", () => {
    expect(
      decideInitialServerSync({
        marker,
        browserFingerprint: "synced-browser-state",
        localFingerprint: "runtime-repaired-state",
        remoteFingerprint: "newer-server-state",
        remoteRevision: 11,
        localHasData: true,
      }),
    ).toBe("use-remote");
  });

  it("keeps a real conflict when both the browser and server changed since the last sync", () => {
    expect(
      decideInitialServerSync({
        marker,
        browserFingerprint: "locally-edited-state",
        localFingerprint: "locally-edited-state",
        remoteFingerprint: "newer-server-state",
        remoteRevision: 11,
        localHasData: true,
      }),
    ).toBe("conflict");
  });

  it("pushes unsynced local changes when the server is still on the same revision", () => {
    expect(
      decideInitialServerSync({
        marker,
        browserFingerprint: "locally-edited-state",
        localFingerprint: "locally-edited-state",
        remoteFingerprint: "old-server-state",
        remoteRevision: 10,
        localHasData: true,
      }),
    ).toBe("push-local");
  });

  it("protects an established local dataset when no sync marker exists and server data differs", () => {
    expect(
      decideInitialServerSync({
        browserFingerprint: "local-state",
        localFingerprint: "local-state",
        remoteFingerprint: "remote-state",
        remoteRevision: 3,
        localHasData: true,
      }),
    ).toBe("conflict");
  });
});
