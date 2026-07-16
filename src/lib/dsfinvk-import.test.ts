import { describe, expect, it } from "vitest";
import {
  createDsfinvkImportPlan,
  parseDsfinvkExport,
  suggestDsfinvkCutoverDate,
} from "./dsfinvk-import";
import type { AppState } from "./types";

const files = new Map<string, string>([
  ["cashpointclosing.csv", csv(
    ["Z_KASSE_ID", "Z_ERSTELLUNG", "Z_NR", "Z_BUCHUNGSTAG", "NAME", "Z_SE_ZAHLUNGEN", "Z_SE_BARZAHLUNGEN"],
    [["register-1", "2026-06-24T18:00:00Z", "240", "", "Handyshop Sun-Tel", "119.00", "19.00"]],
  )],
  ["payment.csv", csv(
    ["Z_KASSE_ID", "Z_NR", "ZAHLART_TYP", "Z_ZAHLART_BETRAG"],
    [["register-1", "240", "Bar", "19.00"], ["register-1", "240", "Unbar", "100.00"]],
  )],
  ["businesscases.csv", csv(
    ["Z_KASSE_ID", "Z_NR", "GV_TYP", "UST_SCHLUESSEL", "Z_UMS_BRUTTO", "Z_UMS_NETTO", "Z_UST"],
    [["register-1", "240", "Umsatz", "1", "119.00", "100.00", "19.00"]],
  )],
  ["transactions.csv", csv(
    ["Z_KASSE_ID", "Z_NR", "BON_ID", "BON_NR", "UMS_BRUTTO"],
    [["register-1", "240", "bon-1", "1001", "19.00"], ["register-1", "240", "bon-2", "1002", "100.00"]],
  )],
  ["transactions_vat.csv", csv(
    ["Z_KASSE_ID", "Z_NR", "BON_ID", "UST_SCHLUESSEL", "BON_BRUTTO", "BON_NETTO", "BON_UST"],
    [["register-1", "240", "bon-1", "1", "19.00", "15.97", "3.03"], ["register-1", "240", "bon-2", "1", "100.00", "84.03", "15.97"]],
  )],
  ["datapayment.csv", csv(
    ["Z_KASSE_ID", "Z_NR", "BON_ID", "ZAHLART_TYP", "BASISWAEH_BETRAG"],
    [["register-1", "240", "bon-1", "Bar", "19.00"], ["register-1", "240", "bon-2", "Unbar", "100.00"]],
  )],
  ["vat.csv", csv(
    ["Z_KASSE_ID", "Z_NR", "UST_SCHLUESSEL", "UST_SATZ", "UST_BESCHR"],
    [["register-1", "240", "1", "19.00", "Regelsteuersatz"]],
  )],
]);

describe("Flatpay DSFinV-K bulk import", () => {
  it("parses a complete daily closing and allocates cash and card without double counting", () => {
    const report = parseDsfinvkExport(files);
    expect(report).toMatchObject({
      startDate: "2026-06-24",
      endDate: "2026-06-24",
      totalPayments: 119,
      totalCash: 19,
      totalCard: 100,
      totalVat: 19,
      receiptCount: 2,
    });
    expect(report.closings[0].allocations).toEqual([
      expect.objectContaining({ paymentMethod: "card", taxRate: 19, gross: 100, tax: 15.97 }),
      expect.objectContaining({ paymentMethod: "cash", taxRate: 19, gross: 19, tax: 3.03 }),
    ]);
  });

  it("defaults to the day after the last KAS booking and books only the new Flatpay period", () => {
    const state = makeState();
    state.ledger.push({
      id: "kas-last", date: "2026-06-23", direction: "income", amount: 10,
      paymentMethod: "cash", description: "KAS", category: "8400 · Erlöse",
      source: "kasImport", sourceId: "kas:test:1", taxAmount: 1.6, taxRate: 19,
      taxMode: "standard19", reconciled: true, accountCode: "8400",
      counterAccountCode: "1000", cashChange: 10, createdAt: "2026-06-23T12:00:00Z",
    });
    const report = parseDsfinvkExport(files);
    const cutover = suggestDsfinvkCutoverDate(state, report);
    expect(cutover).toBe("2026-06-24");
    const plan = createDsfinvkImportPlan(state, report, "flatpay.zip", cutover);
    expect(plan.bookedClosings).toBe(1);
    expect(plan.archiveOnlyClosings).toBe(0);
    expect(plan.entries).toHaveLength(2);
    expect(plan.entries.reduce((sum, entry) => sum + (entry.cashChange || 0), 0)).toBe(19);
    expect(plan.entries.find((entry) => entry.paymentMethod === "card")).toMatchObject({ counterAccountCode: "1360", cashChange: 0 });
  });

  it("archives earlier closings without booking them twice", () => {
    const report = parseDsfinvkExport(files);
    const plan = createDsfinvkImportPlan(makeState(), report, "flatpay.zip", "2026-06-25");
    expect(plan.archiveOnlyClosings).toBe(1);
    expect(plan.entries).toHaveLength(0);
    expect(plan.documents.some((document) => document.metadata?.reportKind === "DSFinV-K Tagesabschluss")).toBe(true);
  });
});

function csv(header: string[], rows: string[][]): string {
  return [header, ...rows].map((row) => row.map((value) => `"${value}"`).join(";")).join("\r\n");
}

function makeState(): AppState {
  return {
    version: 1,
    customers: [], devices: [], purchases: [], sales: [], documents: [], ledger: [], importedTransactions: [],
    settings: {
      businessName: "Handyshop Sun-Tel", ownerName: "Ali Sun", street: "", postalCode: "", city: "",
      phone: "", email: "", taxNumber: "", vatId: "", iban: "", invoicePrefix: "RE",
      receiptPrefix: "QU", purchasePrefix: "ANK", currency: "EUR", language: "de", openingCash: 0,
    },
  };
}
