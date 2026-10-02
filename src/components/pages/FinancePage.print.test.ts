import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("finance PDF export", () => {
  it("offers print-to-PDF and a dedicated printable report layout", () => {
    const page = readFileSync(resolve(process.cwd(), "src/components/pages/FinancePage.tsx"), "utf8");
    const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

    expect(page).toContain("PDF speichern / Drucken");
    expect(page).toContain("window.print()");
    expect(page).toContain('className="finance-print-root"');
    expect(page).toContain('className="finance-print-header"');
    expect(page).toContain('className="finance-print-assumptions"');
    expect(page).toContain('className="finance-print-footer"');

    expect(css).toContain(".finance-print-root");
    expect(css).toContain(".finance-print-header");
    expect(css).toContain(".finance-print-assumptions");
    expect(css).toContain(".finance-print-footer");
    expect(css).toContain(".finance-print-root .finance-monthly-card");
  });
});
