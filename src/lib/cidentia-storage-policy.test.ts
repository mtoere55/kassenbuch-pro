import { afterEach, describe, expect, it, vi } from "vitest";
import { cidentiaStoragePolicy } from "./cidentia-storage-policy";

describe("Cidentia storage policy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("normalizes the configured legacy owner CID", () => {
    vi.stubEnv("KASSENBUCH_LEGACY_OWNER_CID", " cid-26-00004 ");
    expect(cidentiaStoragePolicy()).toEqual({ legacyOwnerCid: "CID-26-00004" });
  });

  it("does not publish an invalid owner scope", () => {
    vi.stubEnv("KASSENBUCH_LEGACY_OWNER_CID", "??");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(cidentiaStoragePolicy()).toEqual({});
  });
});
