import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("persistent app hydration", () => {
  it("repairs historical deposits and fixes the April opening balance before CID server sync", () => {
    const shell = readFileSync(resolve(process.cwd(), "src/components/PersistentKassenApp.tsx"), "utf8");
    const sync = readFileSync(resolve(process.cwd(), "src/components/CidServerSynchronizer.tsx"), "utf8");

    expect(shell).toContain("<CidServerSynchronizer cid={cidSession.cid} />");
    expect(sync).toContain('import { repairHistoricalCashDeposits } from "@/lib/cash-deposit-repair"');
    expect(sync).toContain('import { ensureApril2026OpeningCash } from "@/lib/cash-opening-balance"');
    expect(sync).toContain("ensureApril2026OpeningCash(repairHistoricalCashDeposits(state))");
    expect(sync).toContain("mergeStateWithBrowserAttachments");
  });
});
