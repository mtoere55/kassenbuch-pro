"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  calculateSaleMetrics,
  getTaxAmountFromGross,
  makeId,
  nextSequence,
  todayIso,
} from "./accounting";
import type {
  AppState,
  BusinessDocument,
  Customer,
  Device,
  ImportedTransaction,
  LedgerEntry,
  PaymentMethod,
  TaxMode,
} from "./types";

const STORAGE_KEY = "kassenbuch-pro-state-v1";

const now = new Date().toISOString();
const today = todayIso();

export const initialState: AppState = {
  version: 1,
  customers: [
    {
      id: "customer_demo_1",
      customerNumber: "KD-2026-0001",
      type: "private",
      firstName: "Mehmet",
      lastName: "Yılmaz",
      street: "Musterstraße 12",
      postalCode: "58095",
      city: "Hagen",
      phone: "0151 23456789",
      email: "mehmet@example.de",
      roles: ["customer", "supplier"],
      createdAt: now,
    },
  ],
  devices: [
    {
      id: "device_demo_1",
      stockNumber: "GER-2026-0001",
      category: "Smartphone",
      brand: "Apple",
      model: "iPhone 13 128 GB",
      imei1: "490154203237518",
      storage: "128 GB",
      color: "Mitternacht",
      condition: "good",
      status: "inStock",
      purchaseId: "purchase_demo_1",
      purchasePrice: 250,
      purchaseDate: today,
      purchasedFromCustomerId: "customer_demo_1",
      taxMode: "differential",
      repairCosts: 20,
      askingPrice: 399,
      createdAt: now,
    },
  ],
  purchases: [
    {
      id: "purchase_demo_1",
      purchaseNumber: "ANK-2026-0001",
      customerId: "customer_demo_1",
      deviceId: "device_demo_1",
      date: today,
      price: 250,
      paymentMethod: "cash",
      taxMode: "differential",
      documentId: "doc_demo_purchase_1",
      createdAt: now,
    },
  ],
  sales: [],
  documents: [
    {
      id: "doc_demo_purchase_1",
      documentNumber: "ANK-2026-0001",
      type: "purchaseContract",
      date: today,
      customerId: "customer_demo_1",
      deviceId: "device_demo_1",
      purchaseId: "purchase_demo_1",
      amount: 250,
      taxAmount: 0,
      taxMode: "differential",
      paymentMethod: "cash",
      status: "paid",
      createdAt: now,
    },
  ],
  ledger: [
    {
      id: "ledger_demo_purchase_1",
      date: today,
      direction: "expense",
      amount: 250,
      paymentMethod: "cash",
      description: "Ankauf Apple iPhone 13 128 GB",
      category: "Wareneinkauf Gebrauchtgeräte",
      source: "purchase",
      sourceId: "purchase_demo_1",
      documentId: "doc_demo_purchase_1",
      customerId: "customer_demo_1",
      taxAmount: 0,
      taxRate: 0,
      taxMode: "differential",
      reconciled: true,
      createdAt: now,
    },
  ],
  importedTransactions: [],
  settings: {
    businessName: "Handyshop Sun-Tel",
    ownerName: "Murat Toere",
    street: "Badstraße 6",
    postalCode: "58095",
    city: "Hagen",
    phone: "02331 3484182",
    email: "info@example.de",
    taxNumber: "32152630784",
    vatId: "",
    iban: "",
    invoicePrefix: "RE",
    receiptPrefix: "QU",
    purchasePrefix: "ANK",
    currency: "EUR",
    language: "de",
    openingCash: 100,
  },
};

type NewCustomerInput = Omit<Customer, "id" | "customerNumber" | "createdAt">;

export interface NewPurchaseInput {
  customerId?: string;
  date: string;
  paymentMethod: PaymentMethod;
  price: number;
  taxMode: TaxMode;
  category: string;
  brand: string;
  model: string;
  imei1: string;
  imei2?: string;
  serialNumber?: string;
  storage?: string;
  color?: string;
  condition: Device["condition"];
  repairCosts?: number;
  askingPrice?: number;
  notes?: string;
}

export interface NewSaleInput {
  customerId?: string;
  deviceId: string;
  date: string;
  paymentMethod: PaymentMethod;
  price: number;
  documentType: "invoice" | "receipt";
}

interface NewScannedZReportInput {
  date: string;
  zNumber?: string;
  gross: number;
  net?: number;
  vat?: number;
  cash: number;
  card: number;
  salesCount?: number;
  difference?: number;
  imageDataUrl?: string;
  fileName?: string;
  ocrText?: string;
  bookSales: boolean;
}

interface NewSupplierInvoiceInput {
  date: string;
  vendor: string;
  invoiceNumber?: string;
  gross: number;
  vat?: number;
  paymentMethod: PaymentMethod;
  imageDataUrl?: string;
  fileName?: string;
  ocrText?: string;
}

interface StoreValue {
  state: AppState;
  hydrated: boolean;
  addCustomer: (input: NewCustomerInput) => Customer;
  addPurchase: (input: NewPurchaseInput) => { device: Device; document: BusinessDocument };
  addSale: (input: NewSaleInput) => { document: BusinessDocument };
  addScannedZReport: (input: NewScannedZReportInput) => BusinessDocument;
  addSupplierInvoice: (input: NewSupplierInvoiceInput) => BusinessDocument;
  importTransactions: (transactions: ImportedTransaction[]) => number;
  reconcileImportedTransactions: () => number;
  updateSettings: (patch: Partial<AppState["settings"]>) => void;
  updateDevice: (deviceId: string, patch: Partial<Device>) => void;
  resetDemo: () => void;
  replaceState: (next: AppState) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function KassenProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(initialState);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        // Hydration intentionally restores the external localStorage snapshot once.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setState(JSON.parse(saved) as AppState);
      }
    } catch (error) {
      console.error("Gespeicherte Daten konnten nicht geladen werden", error);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [hydrated, state]);

  const addCustomer = useCallback((input: NewCustomerInput) => {
    let created!: Customer;
    setState((current) => {
      created = {
        ...input,
        id: makeId("customer"),
        customerNumber: nextSequence(
          "KD",
          current.customers.map((customer) => customer.customerNumber),
        ),
        createdAt: new Date().toISOString(),
      };
      return { ...current, customers: [created, ...current.customers] };
    });
    return created;
  }, []);

  const addPurchase = useCallback((input: NewPurchaseInput) => {
    let result!: { device: Device; document: BusinessDocument };
    setState((current) => {
      if (
        current.devices.some(
          (device) => device.imei1 === input.imei1 || device.imei2 === input.imei1,
        )
      ) {
        throw new Error("Diese IMEI ist bereits im System vorhanden.");
      }
      const createdAt = new Date().toISOString();
      const purchaseId = makeId("purchase");
      const deviceId = makeId("device");
      const documentId = makeId("document");
      const purchaseNumber = nextSequence(
        current.settings.purchasePrefix,
        current.purchases.map((purchase) => purchase.purchaseNumber),
        new Date(`${input.date}T12:00:00`),
      );
      const device: Device = {
        id: deviceId,
        stockNumber: nextSequence(
          "GER",
          current.devices.map((item) => item.stockNumber),
          new Date(`${input.date}T12:00:00`),
        ),
        category: input.category,
        brand: input.brand,
        model: input.model,
        imei1: input.imei1,
        imei2: input.imei2,
        serialNumber: input.serialNumber,
        storage: input.storage,
        color: input.color,
        condition: input.condition,
        status: "inStock",
        purchaseId,
        purchasePrice: input.price,
        purchaseDate: input.date,
        purchasedFromCustomerId: input.customerId,
        taxMode: input.taxMode,
        repairCosts: input.repairCosts ?? 0,
        askingPrice: input.askingPrice,
        createdAt,
      };
      const purchase = {
        id: purchaseId,
        purchaseNumber,
        customerId: input.customerId,
        deviceId,
        date: input.date,
        price: input.price,
        paymentMethod: input.paymentMethod,
        taxMode: input.taxMode,
        documentId,
        notes: input.notes,
        createdAt,
      };
      const document: BusinessDocument = {
        id: documentId,
        documentNumber: purchaseNumber,
        type: "purchaseContract",
        date: input.date,
        customerId: input.customerId,
        deviceId,
        purchaseId,
        amount: input.price,
        taxAmount: 0,
        taxMode: input.taxMode,
        paymentMethod: input.paymentMethod,
        status: "paid",
        createdAt,
      };
      const ledgerEntry: LedgerEntry = {
        id: makeId("ledger"),
        date: input.date,
        direction: "expense",
        amount: input.price,
        paymentMethod: input.paymentMethod,
        description: `Ankauf ${input.brand} ${input.model}`,
        category: "Wareneinkauf Gebrauchtgeräte",
        source: "purchase",
        sourceId: purchaseId,
        documentId,
        customerId: input.customerId,
        taxAmount: 0,
        taxRate: 0,
        taxMode: input.taxMode,
        reconciled: true,
        createdAt,
      };
      result = { device, document };
      return {
        ...current,
        devices: [device, ...current.devices],
        purchases: [purchase, ...current.purchases],
        documents: [document, ...current.documents],
        ledger: [ledgerEntry, ...current.ledger],
      };
    });
    return result;
  }, []);

  const addSale = useCallback((input: NewSaleInput) => {
    let result!: { document: BusinessDocument };
    setState((current) => {
      const device = current.devices.find((item) => item.id === input.deviceId);
      if (!device) throw new Error("Gerät wurde nicht gefunden.");
      if (device.status === "sold") throw new Error("Dieses Gerät wurde bereits verkauft.");
      const createdAt = new Date().toISOString();
      const saleId = makeId("sale");
      const documentId = makeId("document");
      const prefix =
        input.documentType === "invoice"
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
        taxMode: device.taxMode,
      });
      const sale = {
        id: saleId,
        saleNumber: documentNumber,
        customerId: input.customerId,
        deviceId: device.id,
        date: input.date,
        price: input.price,
        paymentMethod: input.paymentMethod,
        taxMode: device.taxMode,
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
        taxMode: device.taxMode,
        paymentMethod: input.paymentMethod,
        status: "paid",
        createdAt,
      };
      const ledgerEntry: LedgerEntry = {
        id: makeId("ledger"),
        date: input.date,
        direction: "income",
        amount: input.price,
        paymentMethod: input.paymentMethod,
        description: `Verkauf ${device.brand} ${device.model}`,
        category:
          device.taxMode === "differential"
            ? "Erlöse §25a Differenzbesteuerung"
            : "Warenerlöse 19 %",
        source: "sale",
        sourceId: saleId,
        documentId,
        customerId: input.customerId,
        taxAmount: metrics.taxAmount,
        taxRate: device.taxMode === "taxFree" ? 0 : 19,
        taxMode: device.taxMode,
        reconciled: true,
        createdAt,
      };
      result = { document };
      return {
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
      };
    });
    return result;
  }, []);

  const addScannedZReport = useCallback((input: NewScannedZReportInput) => {
    let created!: BusinessDocument;
    setState((current) => {
      const duplicate = current.documents.some(
        (document) =>
          document.type === "zReport" &&
          document.date === input.date &&
          document.metadata?.zNumber === input.zNumber,
      );
      if (duplicate && input.zNumber) {
        throw new Error("Dieser Z-Bericht wurde bereits erfasst.");
      }
      const createdAt = new Date().toISOString();
      const documentId = makeId("document");
      created = {
        id: documentId,
        documentNumber: input.zNumber ? `Z-${input.zNumber}` : nextSequence("Z", []),
        type: "zReport",
        date: input.date,
        amount: input.gross,
        taxAmount: input.vat ?? getTaxAmountFromGross(input.gross),
        taxMode: "standard19",
        status: "archived",
        originalFileName: input.fileName,
        originalImageDataUrl: input.imageDataUrl,
        ocrText: input.ocrText,
        metadata: {
          zNumber: input.zNumber ?? null,
          cash: input.cash,
          card: input.card,
          salesCount: input.salesCount ?? null,
          difference: input.difference ?? null,
          bookSales: input.bookSales,
        },
        createdAt,
      };
      const ledgerEntries: LedgerEntry[] = [];
      if (input.bookSales && input.cash > 0) {
        ledgerEntries.push({
          id: makeId("ledger"),
          date: input.date,
          direction: "income",
          amount: input.cash,
          paymentMethod: "cash",
          description: `Tagesumsatz Z-Bericht ${input.zNumber ?? ""}`.trim(),
          category: "Tagesumsatz 19 %",
          source: "scan",
          sourceId: documentId,
          documentId,
          taxAmount: getTaxAmountFromGross(input.cash),
          taxRate: 19,
          taxMode: "standard19",
          reconciled: true,
          createdAt,
        });
      }
      if (input.bookSales && input.card > 0) {
        ledgerEntries.push({
          id: makeId("ledger"),
          date: input.date,
          direction: "income",
          amount: input.card,
          paymentMethod: "card",
          description: `Kartenzahlungen Z-Bericht ${input.zNumber ?? ""}`.trim(),
          category: "Tagesumsatz 19 %",
          source: "scan",
          sourceId: documentId,
          documentId,
          taxAmount: getTaxAmountFromGross(input.card),
          taxRate: 19,
          taxMode: "standard19",
          reconciled: true,
          createdAt,
        });
      }
      return {
        ...current,
        documents: [created, ...current.documents],
        ledger: [...ledgerEntries, ...current.ledger],
      };
    });
    return created;
  }, []);

  const addSupplierInvoice = useCallback((input: NewSupplierInvoiceInput) => {
    let created!: BusinessDocument;
    setState((current) => {
      const createdAt = new Date().toISOString();
      const documentId = makeId("document");
      const taxAmount = input.vat ?? getTaxAmountFromGross(input.gross);
      created = {
        id: documentId,
        documentNumber:
          input.invoiceNumber ||
          nextSequence(
            "ER",
            current.documents.map((document) => document.documentNumber),
          ),
        type: "supplierInvoice",
        date: input.date,
        amount: input.gross,
        taxAmount,
        taxMode: "standard19",
        paymentMethod: input.paymentMethod,
        status: "paid",
        originalFileName: input.fileName,
        originalImageDataUrl: input.imageDataUrl,
        ocrText: input.ocrText,
        metadata: { vendor: input.vendor },
        createdAt,
      };
      const ledgerEntry: LedgerEntry = {
        id: makeId("ledger"),
        date: input.date,
        direction: "expense",
        amount: input.gross,
        paymentMethod: input.paymentMethod,
        description: `Eingangsrechnung ${input.vendor}`,
        category: "Betriebsausgaben / Wareneinkauf",
        source: "scan",
        sourceId: documentId,
        documentId,
        taxAmount,
        taxRate: 19,
        taxMode: "standard19",
        reconciled: false,
        createdAt,
      };
      return {
        ...current,
        documents: [created, ...current.documents],
        ledger: [ledgerEntry, ...current.ledger],
      };
    });
    return created;
  }, []);

  const importTransactions = useCallback((transactions: ImportedTransaction[]) => {
    let count = 0;
    setState((current) => {
      const keys = new Set(
        current.importedTransactions.map(
          (item) => `${item.accountType}|${item.externalId ?? ""}|${item.date}|${item.amount}|${item.description}`,
        ),
      );
      const unique = transactions.filter((item) => {
        const key = `${item.accountType}|${item.externalId ?? ""}|${item.date}|${item.amount}|${item.description}`;
        if (keys.has(key)) return false;
        keys.add(key);
        return true;
      });
      count = unique.length;
      return {
        ...current,
        importedTransactions: [...unique, ...current.importedTransactions],
      };
    });
    return count;
  }, []);

  const reconcileImportedTransactions = useCallback(() => {
    let matched = 0;
    setState((current) => {
      const updated = current.importedTransactions.map((transaction) => {
        if (transaction.status === "matched" || transaction.status === "ignored") return transaction;
        const candidates = current.documents
          .map((document) => {
            const amountScore = Math.abs(document.amount - Math.abs(transaction.amount)) < 0.01 ? 70 : 0;
            const dateDistance = Math.abs(
              new Date(document.date).getTime() - new Date(transaction.date).getTime(),
            );
            const dateScore = dateDistance <= 7 * 86_400_000 ? 20 : 0;
            const text = transaction.description.toLowerCase();
            const numberScore = text.includes(document.documentNumber.toLowerCase()) ? 10 : 0;
            return { document, score: amountScore + dateScore + numberScore };
          })
          .sort((a, b) => b.score - a.score);
        const best = candidates[0];
        if (!best || best.score < 80) {
          return { ...transaction, matchConfidence: best?.score ?? 0, status: "needsReview" as const };
        }
        matched += 1;
        return {
          ...transaction,
          matchedDocumentId: best.document.id,
          matchConfidence: best.score,
          status: "matched" as const,
        };
      });
      return { ...current, importedTransactions: updated };
    });
    return matched;
  }, []);

  const updateSettings = useCallback((patch: Partial<AppState["settings"]>) => {
    setState((current) => ({
      ...current,
      settings: { ...current.settings, ...patch },
    }));
  }, []);

  const updateDevice = useCallback((deviceId: string, patch: Partial<Device>) => {
    setState((current) => ({
      ...current,
      devices: current.devices.map((device) =>
        device.id === deviceId ? { ...device, ...patch } : device,
      ),
    }));
  }, []);

  const resetDemo = useCallback(() => setState(initialState), []);
  const replaceState = useCallback((next: AppState) => setState(next), []);

  const value = useMemo<StoreValue>(
    () => ({
      state,
      hydrated,
      addCustomer,
      addPurchase,
      addSale,
      addScannedZReport,
      addSupplierInvoice,
      importTransactions,
      reconcileImportedTransactions,
      updateSettings,
      updateDevice,
      resetDemo,
      replaceState,
    }),
    [
      state,
      hydrated,
      addCustomer,
      addPurchase,
      addSale,
      addScannedZReport,
      addSupplierInvoice,
      importTransactions,
      reconcileImportedTransactions,
      updateSettings,
      updateDevice,
      resetDemo,
      replaceState,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useKassenStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error("useKassenStore muss innerhalb des KassenProvider verwendet werden.");
  return value;
}
