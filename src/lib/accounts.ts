export interface BookingCategory {
  code: string;
  label: string;
  side: "in" | "out" | "neutral";
  vat: 0 | 7 | 19;
}

export const BOOKING_CATEGORIES: BookingCategory[] = [
  { code: "1000", label: "Kasse", side: "neutral", vat: 0 },
  { code: "1200", label: "Bank", side: "neutral", vat: 0 },
  { code: "1360", label: "Geldtransit", side: "neutral", vat: 0 },
  { code: "1800", label: "Privatentnahme", side: "neutral", vat: 0 },
  { code: "1890", label: "Privateinlage", side: "neutral", vat: 0 },
  { code: "3200", label: "Wareneinkauf", side: "out", vat: 19 },
  { code: "3290", label: "Geräteankauf", side: "out", vat: 0 },
  { code: "4930", label: "Bürobedarf", side: "out", vat: 19 },
  { code: "4980", label: "Sonstiger Betriebsbedarf", side: "out", vat: 19 },
  { code: "8336", label: "Erlöse Differenzbesteuerung", side: "in", vat: 0 },
  { code: "8400", label: "Erlöse 19 %", side: "in", vat: 19 },
  { code: "8600", label: "Steuerfreie Erlöse", side: "in", vat: 0 },
];

export function getBookingCategory(code?: string) {
  return BOOKING_CATEGORIES.find((item) => item.code === code);
}
