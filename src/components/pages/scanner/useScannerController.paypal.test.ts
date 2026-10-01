import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Universal PayPal PDF routing", () => {
  it("routes PayPal monthly statements before generic invoice detection", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/pages/scanner/useScannerController.ts"), "utf8");
    expect(source).toContain("isPayPalMonthlyStatementText");
    expect(source).toContain("parsePayPalMonthlyStatement");
    expect(source).toContain("importPayPalMonthlyStatement");
    expect(source).toContain('setUniversalMode("paypalReport")');
    expect(source.indexOf("if (isPayPalMonthlyStatementText(text))")).toBeLessThan(
      source.indexOf("const bankReport = parseSparkasseLayoutStatement(text)"),
    );
  });
});
