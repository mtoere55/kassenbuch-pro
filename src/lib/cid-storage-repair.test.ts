import { describe, expect, it } from "vitest";
import { createEmptyBrowserState } from "./browser-persistence";
import { isLikelyLeakedOwnerState } from "./cid-storage-repair";

function storedState(input?: {
  businessName?: string;
  ownerName?: string;
  taxNumber?: string;
  street?: string;
  postalCode?: string;
  city?: string;
  ids?: string[];
}): string {
  const empty = createEmptyBrowserState();
  return JSON.stringify({
    ...empty,
    settings: {
      ...empty.settings,
      businessName: input?.businessName || "Mein Betrieb",
      ownerName: input?.ownerName || "",
      taxNumber: input?.taxNumber || "",
      street: input?.street || "",
      postalCode: input?.postalCode || "",
      city: input?.city || "",
    },
    customers: (input?.ids || []).map((id) => ({ id })),
  });
}

describe("CID storage leak repair", () => {
  it("detects an exact copied owner state", () => {
    const owner = storedState({
      businessName: "Handyshop Sun-Tel",
      taxNumber: "32152630784",
      ids: ["customer-1"],
    });
    expect(isLikelyLeakedOwnerState(owner, owner)).toBe(true);
  });

  it("detects copied business identity even after minor state changes", () => {
    const owner = storedState({
      businessName: "Handyshop Sun-Tel",
      ownerName: "Murat Toere",
      taxNumber: "32152630784",
      street: "Badstraße 6",
      postalCode: "58095",
      city: "Hagen",
      ids: ["customer-1", "customer-2"],
    });
    const leaked = storedState({
      businessName: "Handyshop Sun-Tel",
      ownerName: "Murat Toere",
      taxNumber: "32152630784",
      street: "Badstraße 6",
      postalCode: "58095",
      city: "Hagen",
      ids: ["customer-1"],
    });
    expect(isLikelyLeakedOwnerState(leaked, owner)).toBe(true);
  });

  it("does not classify an empty or unrelated CID as leaked", () => {
    const owner = storedState({
      businessName: "Handyshop Sun-Tel",
      taxNumber: "32152630784",
      ids: ["customer-1"],
    });
    expect(isLikelyLeakedOwnerState(storedState(), owner)).toBe(false);
    expect(isLikelyLeakedOwnerState(storedState({
      businessName: "Ali Technik",
      taxNumber: "99999999999",
      ids: ["ali-customer-1"],
    }), owner)).toBe(false);
  });
});
