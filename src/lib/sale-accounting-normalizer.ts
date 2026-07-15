import { calculateSaleMetrics } from "./accounting";
import { getBookingCategory } from "./accounts";
import type { AppState, BusinessDocument, LedgerEntry, PaymentMethod, Sale } from "./types";

export function normalizeSaleAccountingState(current: AppState): AppState {
  const salesById = new Map(current.sales.map((sale) => [sale.id, sale]));
  const documentsById = new Map(current.documents.map((document) => [document.id, document]));
  const devicesById = new Map(current.devices.map((device) => [device.id, device]));
  let changed = false;

  const ledger = current.ledger.map((entry) => {
    if (entry.source !== "sale" || !entry.sourceId) return entry;
    const sale = salesById.get(entry.sourceId);
    if (!sale) return entry;
    const document = documentsById.get(sale.documentId);
    const device = devicesById.get(sale.deviceId);
    if (!document || !device) return entry;

    const metrics = calculateSaleMetrics({
      salePrice: sale.price,
      purchasePrice: device.purchasePrice,
      repairCosts: device.repairCosts,
      taxMode: sale.taxMode,
    });
    const accountCode = saleAccountCode(sale);
    const account = getBookingCategory(accountCode);
    const taxAmount = sale.taxMode === "taxFree" ? 0 : metrics.taxAmount;
    const next: LedgerEntry = {
      ...entry,
      date: sale.date,
      amount: sale.price,
      paymentMethod: sale.paymentMethod,
      description: `Verkauf ${device.brand} ${device.model}`,
      category: `${accountCode} · ${account?.label || "Verkaufserlös"}`,
      documentId: sale.documentId,
      customerId: sale.customerId,
      taxAmount,
      taxRate: sale.taxMode === "taxFree" ? 0 : 19,
      taxMode: sale.taxMode,
      reconciled: true,
      accountCode,
      counterAccountCode: paymentAccount(sale.paymentMethod),
      documentNumber: document.documentNumber,
      groupId: sale.id,
      cashChange: sale.paymentMethod === "cash" ? sale.price : 0,
      netAmount: roundMoney(sale.price - taxAmount),
      manualKind: "income",
      note: appendNote(entry.note, saleNote(sale, device.purchasePrice, device.repairCosts, metrics.grossMargin, metrics.differentialVat)),
    };
    if (!same(entry, next)) changed = true;
    return next;
  });

  const documents = current.documents.map((document) => {
    if (!document.saleId) return document;
    const sale = salesById.get(document.saleId);
    const device = sale ? devicesById.get(sale.deviceId) : undefined;
    if (!sale || !device) return document;
    const metrics = calculateSaleMetrics({
      salePrice: sale.price,
      purchasePrice: device.purchasePrice,
      repairCosts: device.repairCosts,
      taxMode: sale.taxMode,
    });
    const metadata: BusinessDocument["metadata"] = {
      ...(document.metadata || {}),
      automaticallyBooked: true,
      accountingDate: sale.date,
      accountingAccountCode: saleAccountCode(sale),
      paymentAccountCode: paymentAccount(sale.paymentMethod),
      differentialPurchasePrice: sale.taxMode === "differential" ? device.purchasePrice : null,
      differentialRepairCosts: sale.taxMode === "differential" ? device.repairCosts : null,
      differentialMargin: sale.taxMode === "differential" ? metrics.grossMargin : null,
      differentialVat: sale.taxMode === "differential" ? metrics.differentialVat : null,
      differentialTaxNote: sale.taxMode === "differential" ? "Besteuerung nach § 25a UStG; Umsatzsteuer wird nicht gesondert ausgewiesen." : null,
    };
    const next: BusinessDocument = {
      ...document,
      date: sale.date,
      amount: sale.price,
      taxAmount: sale.taxMode === "taxFree" ? 0 : metrics.taxAmount,
      taxMode: sale.taxMode,
      paymentMethod: sale.paymentMethod,
      status: "paid",
      metadata,
    };
    if (!same(document, next)) changed = true;
    return next;
  });

  return changed ? { ...current, ledger, documents } : current;
}

function saleAccountCode(sale: Sale): string {
  if (sale.taxMode === "differential") return "8336";
  if (sale.taxMode === "taxFree") return "8600";
  return "8400";
}

function paymentAccount(method: PaymentMethod): string {
  return ({ cash: "1000", card: "1360", bank: "1200", paypal: "1370" } as const)[method];
}

function saleNote(
  sale: Sale,
  purchasePrice: number,
  repairCosts: number,
  margin: number,
  differentialVat: number,
): string {
  if (sale.taxMode !== "differential") {
    return `Automatisch mit ${paymentAccount(sale.paymentMethod)} gebucht.`;
  }
  return `§25a intern: Einkauf ${money(purchasePrice)}, Reparatur ${money(repairCosts)}, Differenz ${money(margin)}, enthaltene USt ${money(differentialVat)}. Auf dem Kundenbeleg wird die Umsatzsteuer nicht gesondert ausgewiesen.`;
}

function appendNote(current: string | undefined, addition: string): string {
  if (!current) return addition;
  return current.includes(addition) ? current : `${current} · ${addition}`;
}

function money(value: number): string {
  return `${roundMoney(value).toFixed(2)} EUR`;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
