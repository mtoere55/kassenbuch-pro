import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("repair booking date", () => {
  const source = readFileSync(resolve(process.cwd(), "src/components/pages/RepairPage.tsx"), "utf8");

  it("uses the selected date for repair, document and ledger records", () => {
    expect(source).toContain("const bookingDate = draft.date");
    expect(source).toContain("date: bookingDate, customerId, repairId");
    expect(source).toContain("date: bookingDate, brand: draft.brand.trim()");
    expect(source).toContain("ledgerId ? { id: ledgerId, date: bookingDate");
  });

  it("preserves the selected date after a repair is saved", () => {
    expect(source).toContain("setDraft(createDraft(bookingDate))");
    expect(source).not.toContain("setDraft(createDraft());");
  });

  it("labels the field as repair and booking date and validates it", () => {
    expect(source).toContain('label="Reparaturdatum / Buchungsdatum"');
    expect(source).toContain("if (!isValidDate(draft.date))");
  });
});
