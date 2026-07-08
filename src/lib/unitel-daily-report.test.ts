import { describe, expect, it } from "vitest";
import { initialState } from "./store";
import {
  createUnitelDailyImportPlan,
  parseUnitelDailyReport,
  validateUnitelDailyReport,
} from "./unitel-daily-report";

const sample = `Benutzername\tKatenname\tEinkaufspreis\tSatış fiyatı\tAnzahl\tEinkaufssume\tVerkaufssumme\tGewinn\tBestelldatum
Ali Sun\tAY Yıldız 10,00 €\t9,65 €\t10,00 €\t3\t28,95 €\t30,00 €\t1,05 €\t01-04-2026
Ali Sun\tLycaMobile 10 10,00 €\t9,15 €\t10,00 €\t4\t36,60 €\t40,00 €\t3,40 €\t01-04-2026
Ali Sun\tPaysafe 20,00 €\t19,60 €\t20,00 €\t1\t19,60 €\t20,00 €\t0,40 €\t02-04-2026
 \tGesamtesumme \t8\t85,15 €\t90,00 €\t4,85 €\t
© 2007 Pin-Sales.de`;

describe("Pin-Sales / UniTel daily report", () => {
  it("parses detail rows, days, month and declared totals", () => {
    const report = parseUnitelDailyReport(sample);
    expect(report).toMatchObject({
      startDate: "2026-04-01",
      endDate: "2026-04-02",
      lineCount: 3,
      dayCount: 2,
      quantity: 8,
      purchaseTotal: 85.15,
      salesTotal: 90,
      profit: 4.85,
    });
    expect(report.days).toEqual([
      {
        date: "2026-04-01",
        lineCount: 2,
        quantity: 7,
        purchaseTotal: 65.55,
        salesTotal: 70,
        profit: 4.45,
      },
      {
        date: "2026-04-02",
        lineCount: 1,
        quantity: 1,
        purchaseTotal: 19.6,
        salesTotal: 20,
        profit: 0.4,
      },
    ]);
    expect(report.months[0]).toMatchObject({
      month: "2026-04",
      dayCount: 2,
      quantity: 8,
      purchaseTotal: 85.15,
      salesTotal: 90,
      profit: 4.85,
    });
    expect(validateUnitelDailyReport(report)).toEqual({ valid: true, issues: [] });
  });

  it("creates daily clearing entries and one monthly commission entry", () => {
    const report = parseUnitelDailyReport(sample);
    const plan = createUnitelDailyImportPlan(
      initialState,
      report,
      { "2026-04-01": 70, "2026-04-02": 10 },
      "pin-sales.txt",
    );
    expect(plan.salesEntries).toBe(3);
    expect(plan.commissionEntries).toBe(1);
    expect(plan.entries).toHaveLength(4);

    const dayOneCash = plan.entries.find((entry) => entry.sourceId?.endsWith("2026-04-01:cash"));
    const dayTwoCash = plan.entries.find((entry) => entry.sourceId?.endsWith("2026-04-02:cash"));
    const dayTwoCard = plan.entries.find((entry) => entry.sourceId?.endsWith("2026-04-02:card"));
    const commission = plan.entries.find((entry) => entry.sourceId?.startsWith("unitel-commission:"));

    expect(dayOneCash).toMatchObject({ direction: "transfer", amount: 70, cashChange: 70, counterAccountCode: "1590" });
    expect(dayTwoCash).toMatchObject({ direction: "transfer", amount: 10, cashChange: 10 });
    expect(dayTwoCard).toMatchObject({ direction: "transfer", amount: 10, cashChange: 0, paymentMethod: "card" });
    expect(commission).toMatchObject({ direction: "income", amount: 4.85, taxRate: 19, accountCode: "8400", counterAccountCode: "1590", cashChange: 0 });
    expect(commission?.taxAmount).toBe(0.77);
    expect(plan.document.metadata?.createdLedgerEntries).toBe(4);
  });

  it("blocks invalid payment allocation and duplicate imports", () => {
    const report = parseUnitelDailyReport(sample);
    expect(() => createUnitelDailyImportPlan(
      initialState,
      report,
      { "2026-04-01": 71, "2026-04-02": 20 },
      "pin-sales.txt",
    )).toThrow(/Bar-Aufteilung/);

    const plan = createUnitelDailyImportPlan(
      initialState,
      report,
      { "2026-04-01": 70, "2026-04-02": 20 },
      "pin-sales.txt",
    );
    expect(() => createUnitelDailyImportPlan(
      { ...initialState, documents: [plan.document, ...initialState.documents] },
      report,
      { "2026-04-01": 70, "2026-04-02": 20 },
      "pin-sales.txt",
    )).toThrow(/bereits/);
  });
});
