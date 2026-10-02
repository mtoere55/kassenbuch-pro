import { describe, expect, it } from "vitest";
import { createEmptyBrowserState } from "./browser-persistence";
import { isMeaningfulState } from "./server-sync-client";

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
