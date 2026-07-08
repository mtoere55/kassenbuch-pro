import { describe, expect, it } from "vitest";
import {
  compareUnitelReportToLedger,
  createUnitelArchivePlan,
  parseUnitelMonthlyReport,
  validateUnitelMonthlyReport,
} from "./unitel-report";
import { initialState } from "./store";
import type { LedgerEntry } from "./types";

const marchText = `
UNITEL GMBH
Lieferung von 01.03.2026 bis 31.03.2026
KundenNr.: ME000377
Rechnung Nr.: ME16938 Datum: 01.04.2026
Gesamt 6760,00
Provision Brutto 397,41
19,00% MwSt auf Vermittlungsprovision 63,45
Netto Provision 333,96
Zu zahlender Betrag / Rech.betrag 6362,59
`;

const mayText = `
UNITEL GMBH
Lieferung von 01.05.2026 bis 31.05.2026
KundenNr.: ME000377
Rechnung Nr.: ME17222 Datum: 01.06.2026
Gesamt 5552,50
Provision Brutto 338,55
19,00% MwSt auf Vermittlungsprovision 54,05
Netto Provision 284,50
Zu zahlender Betrag / Rech.betrag 5213,95
`;

function entry(input: Partial<LedgerEntry> & Pick<LedgerEntry, "id" | "date" | "amount">): LedgerEntry {
  return {
    direction: "income",
    paymentMethod: "cash",
    description: "UniTel Guthaben",
    category: "8600 · Unitel Guthaben",
    source: "manual",
    taxAmount: 0,
    taxRate: 0,
    taxMode: "taxFree",
    reconciled: true,
    createdAt: `${input.date}T12:00:00.000Z`,
    ...input,
  };
}

describe("UniTel monthly settlement", () => {
  it("parses and validates the March invoice", () => {
    const report = parseUnitelMonthlyReport(marchText);
    expect(report).toMatchObject({
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      invoiceNumber: "ME16938",
      invoiceDate: "2026-04-01",
      totalCardValue: 6760,
      commissionGross: 397.41,
      commissionVat: 63.45,
      commissionNet: 333.96,
      payableAmount: 6362.59,
    });
    expect(validateUnitelMonthlyReport(report)).toEqual({ valid: true, issues: [] });
  });

  it("parses the May invoice with a decimal total", () => {
    const report = parseUnitelMonthlyReport(mayText);
    expect(report.totalCardValue).toBe(5552.5);
    expect(report.commissionVat).toBe(54.05);
    expect(validateUnitelMonthlyReport(report).valid).toBe(true);
  });

  it("compares only recognized UniTel or Guthaben ledger entries in the period", () => {
    const report = parseUnitelMonthlyReport(marchText);
    const ledger = [
      entry({ id: "a", date: "2026-03-10", amount: 4000 }),
      entry({ id: "b", date: "2026-03-20", amount: 2760, paymentMethod: "card" }),
      entry({ id: "c", date: "2026-03-20", amount: 999, description: "Handyverkauf", category: "8400 · Erlöse 19 Prozent" }),
      entry({ id: "d", date: "2026-04-01", amount: 100, description: "UniTel Guthaben" }),
    ];
    expect(compareUnitelReportToLedger(report, ledger)).toEqual({
      recognizedEntries: 2,
      ledgerTotal: 6760,
      difference: 0,
      exact: true,
    });
  });

  it("archives only and blocks a duplicate settlement", () => {
    const report = parseUnitelMonthlyReport(marchText);
    const plan = createUnitelArchivePlan(initialState, report, "unitel.pdf");
    expect(plan.document.metadata?.provider).toBe("UniTel");
    expect(plan.document.metadata?.createdLedgerEntries).toBe(0);
    expect(() => createUnitelArchivePlan({
      ...initialState,
      documents: [plan.document, ...initialState.documents],
    }, report, "unitel.pdf")).toThrow(/bereits/);
  });
});
