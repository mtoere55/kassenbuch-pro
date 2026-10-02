import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("CID gateway storage safety", () => {
  it("does not let legacy-owner policy mutate the active CID browser scope", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/CidGateway.tsx"), "utf8");
    expect(source).toContain("activateCidStorageScope(payload.session.cid)");
    expect(source).toContain("repairLeakedCidState(payload.session.cid)");
    expect(source).not.toContain("payload.storagePolicy?.legacyOwnerCid");
  });
});
