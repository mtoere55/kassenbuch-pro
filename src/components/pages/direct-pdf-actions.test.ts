import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("direct PDF actions", () => {
  it("adds direct PDF save buttons to booking, purchase and document flows", () => {
    const booking = readFileSync(resolve(process.cwd(), "src/components/pages/LedgerEntryEditModal.tsx"), "utf8");
    const purchase = readFileSync(resolve(process.cwd(), "src/components/pages/PurchasePage.tsx"), "utf8");
    const documents = readFileSync(resolve(process.cwd(), "src/components/pages/DocumentsPage.tsx"), "utf8");

    expect(booking).toContain("downloadBookingPdf");
    expect(booking).toContain("PDF speichern");
    expect(purchase).toContain("downloadBusinessDocumentPdf");
    expect(purchase).toContain("PDF speichern");
    expect(documents).toContain("downloadBusinessDocumentPdf");
  });
});
