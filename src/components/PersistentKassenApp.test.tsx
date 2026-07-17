import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("persistent app hydration", () => {
  it("runs historical cash-deposit repair automatically after local state hydration", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/PersistentKassenApp.tsx"), "utf8");
    expect(source).toContain('import { repairHistoricalCashDeposits } from "@/lib/cash-deposit-repair"');
    expect(source).toContain("const repairedState = repairHistoricalCashDeposits(state)");
    expect(source).toContain("replaceState(repairedState)");
  });
});
