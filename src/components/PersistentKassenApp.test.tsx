import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("persistent app hydration", () => {
  it("repairs historical deposits and fixes the April opening balance automatically", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/PersistentKassenApp.tsx"), "utf8");
    expect(source).toContain('import { repairHistoricalCashDeposits } from "@/lib/cash-deposit-repair"');
    expect(source).toContain('import { ensureApril2026OpeningCash } from "@/lib/cash-opening-balance"');
    expect(source).toContain("const repairedState = repairHistoricalCashDeposits(state)");
    expect(source).toContain("const migratedState = ensureApril2026OpeningCash(repairedState)");
    expect(source).toContain("replaceState(migratedState)");
  });
});
