import type { BusinessSettings, PageKey } from "./types";

type Language = BusinessSettings["language"];

const dictionaries = {
  de: {
    dashboard: "Übersicht",
    sale: "Verkaufen",
    purchase: "Gerät ankaufen",
    repair: "Reparatur",
    scan: "Datenimport",
    customers: "Kunden",
    devices: "Geräte",
    documents: "Dokumente",
    ledger: "Kassenbuch",
    accounts: "Bank & PayPal",
    settings: "Einstellungen",
    today: "Heute",
    save: "Speichern",
    cancel: "Abbrechen",
    search: "Suchen",
    amount: "Betrag",
    date: "Datum",
    status: "Status",
    actions: "Aktionen",
  },
  tr: {
    dashboard: "Genel bakış",
    sale: "Satış yap",
    purchase: "Cihaz satın al",
    repair: "Tamir / Servis",
    scan: "Veri içe aktarımı",
    customers: "Müşteriler",
    devices: "Cihazlar",
    documents: "Belgeler",
    ledger: "Kasa defteri",
    accounts: "Banka ve PayPal",
    settings: "Ayarlar",
    today: "Bugün",
    save: "Kaydet",
    cancel: "İptal",
    search: "Ara",
    amount: "Tutar",
    date: "Tarih",
    status: "Durum",
    actions: "İşlemler",
  },
  en: {
    dashboard: "Dashboard",
    sale: "New sale",
    purchase: "Buy device",
    repair: "Repair / service",
    scan: "Data import",
    customers: "Customers",
    devices: "Devices",
    documents: "Documents",
    ledger: "Cash book",
    accounts: "Bank & PayPal",
    settings: "Settings",
    today: "Today",
    save: "Save",
    cancel: "Cancel",
    search: "Search",
    amount: "Amount",
    date: "Date",
    status: "Status",
    actions: "Actions",
  },
} as const;

export type TranslationKey = keyof (typeof dictionaries)["de"];

export function t(language: Language, key: TranslationKey): string {
  return dictionaries[language][key] ?? dictionaries.de[key];
}

export function pageLabel(language: Language, page: PageKey): string {
  return t(language, page);
}
