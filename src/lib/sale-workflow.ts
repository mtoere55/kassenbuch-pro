import {
  calculateSaleMetrics,
  makeId,
  nextSequence,
  roundMoney,
} from "./accounting";
import type {
  AppState,
  BusinessDocument,
  PaymentMethod,
  TaxMode,
} from "./types";

export interface DeviceSaleInput {
  customerId?: string;
  deviceId: string;
  date: string;
  paymentMethod: PaymentMethod;
  price: number;
  documentType: "invoice" | "receipt";
  taxMode: TaxMode;
}

export interface DeviceSaleResult {
  state: AppState;
  document: BusinessDocument;
}

export function createDeviceSale(
  current: AppState,
  input: DeviceSaleInput,
): DeviceSaleResult {
  const device = current.devices.find((item) => item.id === input.deviceId);
  if (!device) throw new Error("Gerät wurde nicht gefunden.");
  if (device.status === "sold") throw new Error("Dieses Gerät wurde bereits verkauft.");
  if (!Number.isFinite(input.price) || input.price <= 0) {
    throw new Error("Bitte einen gültigen Verkaufspreis eingeben.");
  }

  const createdAt = new Date().toISOString();
  const saleId = makeId("sale");
  const documentId = makeId("document");
  const prefix = input.documentType === "invoice"
    ? current.settings.invoicePrefix
    : current.settings.receiptPrefix;
  const documentNumber = nextSequence(
    prefix,
    current.documents.map((document) => document.documentNumber),
    new Date(`${input.date}T12:00:00`),
  );
  const metrics = calculateSaleMetrics({
    salePrice: input.price,
    purchasePrice: device.purchasePrice,
    repairCosts: device.repairCosts,
    taxMode: input.taxMode,
  });
  const account = saleAccount(input.taxMode);
  const paymentAccount = {
    cash: "1000",
    card: "1360",
    bank: "1200",
    paypal: "1370",
  }[input.paymentMethod];

  const sale = {
    id: saleId,
    saleNumber: documentNumber,
    customerId: input.customerId,
    deviceId: device.id,
    date: input.date,
    price: input.price,
    paymentMethod: input.paymentMethod,
    taxMode: input.taxMode,
    documentType: input.documentType,
    documentId,
    grossMargin: metrics.grossMargin,
    differentialVat: metrics.differentialVat,
    profitAfterVatAndRepair: metrics.profitAfterVatAndRepair,
    createdAt,
  };
  const document: BusinessDocument = {
    id: documentId,
    documentNumber,
    type: input.documentType,
    date: input.date,
    customerId: input.customerId,
    deviceId: device.id,
    saleId,
    amount: input.price,
    taxAmount: metrics.taxAmount,
    taxMode: input.taxMode,
    paymentMethod: input.paymentMethod,
    status: "paid",
    metadata: {
      purchaseTaxMode: device.taxMode,
      saleTaxMode: input.taxMode,
      legalBasis: taxModeLabel(input.taxMode),
      purchasePrice: device.purchasePrice,
      repairCosts: device.repairCosts,
      differentialMargin: metrics.grossMargin,
    },
    createdAt,
  };
  const ledgerEntry = {
    id: makeId("ledger"),
    date: input.date,
    direction: "income" as const,
    amount: input.price,
    paymentMethod: input.paymentMethod,
    description: `Verkauf ${device.brand} ${device.model}`,
    category: `${account.code} · ${account.label}`,
    source: "sale" as const,
    sourceId: saleId,
    documentId,
    customerId: input.customerId,
    taxAmount: metrics.taxAmount,
    taxRate: input.taxMode === "taxFree" ? 0 : 19,
    taxMode: input.taxMode,
    reconciled: true,
    accountCode: account.code,
    counterAccountCode: paymentAccount,
    documentNumber,
    cashChange: input.paymentMethod === "cash" ? input.price : 0,
    netAmount: roundMoney(input.price - metrics.taxAmount),
    manualKind: "income" as const,
    createdAt,
  };

  return {
    document,
    state: {
      ...current,
      devices: current.devices.map((item) =>
        item.id === device.id
          ? {
              ...item,
              status: "sold" as const,
              saleId,
              salePrice: input.price,
              saleDate: input.date,
              soldToCustomerId: input.customerId,
            }
          : item,
      ),
      sales: [sale, ...current.sales],
      documents: [document, ...current.documents],
      ledger: [ledgerEntry, ...current.ledger],
    },
  };
}

export function taxModeLabel(mode: TaxMode): string {
  if (mode === "differential") return "Differenzbesteuerung nach §25a UStG";
  if (mode === "standard19") return "Regelbesteuerung 19 %";
  return "Steuerfrei / Sonderfall";
}

function saleAccount(mode: TaxMode) {
  if (mode === "differential") {
    return { code: "8390", label: "Erlöse Differenzbesteuerung §25a" };
  }
  if (mode === "standard19") {
    return { code: "8400", label: "Erlöse 19 Prozent" };
  }
  return { code: "8600", label: "Steuerfreie Erlöse" };
}
