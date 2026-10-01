import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Universal Prifoto routing", () => {
  it("routes Prifoto Umsatzbericht before generic invoice detection and books via the v2 clearing model", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/pages/scanner/useScannerController.ts"), "utf8");

    expect(source).toContain('parsePrifotoCashReport');
    expect(source).toContain('createPrifotoCashImportPlanV2');
    expect(source).toContain('if (isPrifotoCashReportText(layout.text))');
    expect(source).toContain('if (isPrifotoCashReportText(text))');
    expect(source).toContain('setUniversalMode("prifotoReport")');
    expect(source).toContain('const plan = createPrifotoCashImportPlanV2');
    expect(source.indexOf('if (isPrifotoCashReportText(text))')).toBeLessThan(source.indexOf('const bankReport = parseSparkasseLayoutStatement(text)'));
  });
});
