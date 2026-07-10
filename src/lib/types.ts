export type PaymentMethod = "cash" | "card" | "bank" | "paypal";
export type TaxMode = "differential" | "standard19" | "taxFree";
export type DeviceStatus =
  | "inStock"
  | "reserved"
  | "inRepair"
  | "sold"
  | "returned"
  | "defective";
export type RepairStatus = "intake" | "estimate" | "approved" | "inRepair" | "done" | "paid" | "cancelled";
export type RepairDocumentType = "estimate" | "invoice" | "receipt";
export type PageKey =
  | "dashboard"
  | "sale"
  | "purchase"
  | "repair"
  | "scan"
  | "customers"
  | "devices"
  | "documents"
  | "ledger"
  | "accounts"
  | "settings";
export type DocumentType =
  | "invoice"
  | "receipt"
  | "estimate"
  | "purchaseContract"
  | "zReport"
  | "supplierInvoice";
export type LedgerDirection = "income" | "expense" | "transfer";
export type LedgerSource =
  | "sale"
  | "purchase"
  | "repair"
  | "scan"
  | "bankImport"
  | "paypalImport"
  | "flatpayImport"
  | "unitelImport"
  | "prifotoImport"
  | "kasImport"
  | "manual";
export type ImportedTransactionType =
  | "payment"
  | "refund"
  | "bankFunding"
  | "bankWithdrawal"
  | "fee"
  | "other";
export type BookkeepingStatus = "unbooked" | "booked" | "reviewed";

export interface Customer {
  id: string;
  customerNumber: string;
  type: "private" | "business";
  firstName: string;
  lastName: string;
  company?: string;
  street?: string;
  postalCode?: string;
  city?: string;
  phone?: string;
  email?: string;
  vatId?: string;
  notes?: string;
  roles: Array<"customer" | "supplier" | "repair">;
  createdAt: string;
}

export interface Device {
  id: string;
  stockNumber: string;
  category: string;
  brand: string;
  model: string;
  imei1: string;
  imei2?: string;
  serialNumber?: string;
  storage?: string;
  color?: string;
  condition: "new" | "veryGood" | "good" | "used" | "defective";
  status: DeviceStatus;
  purchaseId: string;
  purchasePrice: number;
  purchaseDate: string;
  purchasedFromCustomerId?: string;
  taxMode: TaxMode;
  repairCosts: number;
  askingPrice?: number;
  saleId?: string;
  salePrice?: number;
  saleDate?: string;
  soldToCustomerId?: string;
  createdAt: string;
}

export interface Purchase {
  id: string;
  purchaseNumber: string;
  customerId?: string;
  deviceId: string;
  date: string;
  price: number;
  paymentMethod: PaymentMethod;
  taxMode: TaxMode;
  documentId: string;
  notes?: string;
  createdAt: string;
}

export interface Sale {
  id: string;
  saleNumber: string;
  customerId?: string;
  deviceId: string;
  date: string;
  price: number;
  paymentMethod: PaymentMethod;
  taxMode: TaxMode;
  documentType: "invoice" | "receipt";
  documentId: string;
  grossMargin: number;
  differentialVat: number;
  profitAfterVatAndRepair: number;
  createdAt: string;
}

export interface RepairOrder {
  id: string;
  repairNumber: string;
  customerId?: string;
  date: string;
  brand: string;
  model: string;
  imei?: string;
  serialNumber?: string;
  passcode?: string;
  accessories?: string;
  issue: string;
  workDescription: string;
  status: RepairStatus;
  price: number;
  costEstimate?: number;
  paymentMethod: PaymentMethod;
  documentType: RepairDocumentType;
  documentId: string;
  ledgerEntryId?: string;
  notes?: string;
  createdAt: string;
}

export interface BusinessDocument {
  id: string;
  documentNumber: string;
  type: DocumentType;
  date: string;
  customerId?: string;
  deviceId?: string;
  purchaseId?: string;
  saleId?: string;
  repairId?: string;
  amount: number;
  taxAmount: number;
  taxMode: TaxMode;
  paymentMethod?: PaymentMethod;
  status: "draft" | "open" | "paid" | "archived";
  originalFileName?: string;
  originalImageDataUrl?: string;
  ocrText?: string;
  metadata?: Record<string, string | number | boolean | null>;
  createdAt: string;
}

export interface LedgerEntry {
  id: string;
  date: string;
  direction: LedgerDirection;
  amount: number;
  paymentMethod: PaymentMethod;
  description: string;
  category: string;
  source: LedgerSource;
  sourceId?: string;
  documentId?: string;
  customerId?: string;
  taxAmount: number;
  taxRate: number;
  taxMode: TaxMode;
  reconciled: boolean;
  accountCode?: string;
  counterAccountCode?: string;
  documentNumber?: string;
  groupId?: string;
  cashChange?: number;
  netAmount?: number;
  attachmentFileName?: string;
  attachmentDataUrl?: string;
  note?: string;
  manualKind?: "income" | "expense" | "transfer" | "private";
  createdAt: string;
}

export interface ImportedTransaction {
  id: string;
  accountType: "bank" | "paypal";
  date: string;
  time?: string;
  amount: number;
  description: string;
  externalId?: string;
  relatedExternalId?: string;
  transactionType?: ImportedTransactionType;
  grossAmount?: number;
  feeAmount?: number;
  netAmount?: number;
  balanceAfter?: number;
  currency?: string;
  counterparty?: string;
  senderEmail?: string;
  invoiceNumber?: string;
  matchedDocumentId?: string;
  matchedLedgerEntryId?: string;
  feeLedgerEntryId?: string;
  suggestedAccountCode?: string;
  bookkeepingStatus?: BookkeepingStatus;
  matchConfidence: number;
  status: "new" | "matched" | "ignored" | "needsReview";
  createdAt: string;
}

export interface BusinessSettings {
  businessName: string;
  ownerName: string;
  street: string;
  postalCode: string;
  city: string;
  phone: string;
  email: string;
  taxNumber: string;
  vatId: string;
  iban: string;
  invoicePrefix: string;
  receiptPrefix: string;
  purchasePrefix: string;
  currency: "EUR";
  language: "de" | "tr" | "en";
  openingCash: number;
}

export interface AppState {
  version: number;
  customers: Customer[];
  devices: Device[];
  purchases: Purchase[];
  sales: Sale[];
  repairs?: RepairOrder[];
  documents: BusinessDocument[];
  ledger: LedgerEntry[];
  importedTransactions: ImportedTransaction[];
  settings: BusinessSettings;
}
