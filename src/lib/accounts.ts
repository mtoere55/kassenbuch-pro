export interface BookingCategory {
  code: string;
  label: string;
  side: "in" | "out" | "neutral";
  vat: 0 | 7 | 19;
}

export const BOOKING_CATEGORIES: BookingCategory[] = [
  { code: "0000", label: "Nicht zugeordnet", side: "neutral", vat: 0 },
  { code: "1000", label: "Kasse", side: "neutral", vat: 0 },
  { code: "1200", label: "Bank", side: "neutral", vat: 0 },
  { code: "1360", label: "Geldtransit und Karte", side: "neutral", vat: 0 },
  { code: "1370", label: "PayPal", side: "neutral", vat: 0 },
  { code: "1590", label: "Durchlaufende Posten / UniTel", side: "neutral", vat: 0 },
  { code: "1591", label: "Durchlaufende Posten / Ria und MoneyGram", side: "neutral", vat: 0 },
  { code: "1592", label: "Durchlaufende Posten / Prifoto", side: "neutral", vat: 0 },
  { code: "1800", label: "Privatentnahme", side: "neutral", vat: 0 },
  { code: "1890", label: "Privateinlage", side: "neutral", vat: 0 },
  { code: "2740", label: "Sonstige betriebliche Ertraege", side: "in", vat: 0 },
  { code: "3200", label: "Wareneinkauf 19 Prozent", side: "out", vat: 19 },
  { code: "3290", label: "Geraeteankauf Differenzbesteuerung", side: "out", vat: 0 },
  { code: "3400", label: "Ersatzteile und Reparaturmaterial", side: "out", vat: 19 },
  { code: "3430", label: "SIM- und Guthabenkarten-Einkauf", side: "out", vat: 19 },
  { code: "4120", label: "Gehaelter", side: "out", vat: 0 },
  { code: "4130", label: "Gesetzliche soziale Aufwendungen", side: "out", vat: 0 },
  { code: "4140", label: "Mitarbeitergetraenke und Aufmerksamkeiten", side: "out", vat: 19 },
  { code: "4210", label: "Miete und Nebenkosten", side: "out", vat: 0 },
  { code: "4240", label: "Gas Strom Wasser", side: "out", vat: 19 },
  { code: "4610", label: "Werbekosten", side: "out", vat: 19 },
  { code: "4920", label: "Telefon und Internet", side: "out", vat: 19 },
  { code: "4930", label: "Buerobedarf", side: "out", vat: 19 },
  { code: "4970", label: "Zahlungsgebuehren", side: "out", vat: 0 },
  { code: "4980", label: "Sonstiger Betriebsbedarf", side: "out", vat: 19 },
  { code: "8300", label: "Erloese 7 Prozent", side: "in", vat: 7 },
  { code: "8336", label: "Erloese Differenzbesteuerung", side: "in", vat: 0 },
  { code: "8338", label: "EU-Dienstleistungserloese / Google", side: "in", vat: 0 },
  { code: "8390", label: "Erloese Differenzbesteuerung KAS", side: "in", vat: 0 },
  { code: "8400", label: "Erloese 19 Prozent", side: "in", vat: 19 },
  { code: "8401", label: "Erloese 19 Prozent / Prifoto Eigenanteil", side: "in", vat: 19 },
  { code: "8402", label: "Erloese 19 Prozent / Reparatur Service", side: "in", vat: 19 },
  { code: "8403", label: "Provisionserloese 19 Prozent", side: "in", vat: 19 },
  { code: "8600", label: "Steuerfreie Erloese", side: "in", vat: 0 },
];

export function getBookingCategory(code?: string) {
  return BOOKING_CATEGORIES.find((item) => item.code === code);
}
