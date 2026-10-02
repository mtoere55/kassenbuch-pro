"use client";

import { formatCurrency, formatDate } from "./accounting";
import type { AppState, BusinessDocument, Customer, Device, LedgerDirection, PaymentMethod, TaxMode } from "./types";

const PAGE_WIDTH = 1240;
const PAGE_HEIGHT = 1754;
const PDF_WIDTH = 595.28;
const PDF_HEIGHT = 841.89;

export interface BookingPdfData {
  date: string;
  direction: LedgerDirection;
  paymentMethod: PaymentMethod;
  bookingAccountCode: string;
  bookingAccountLabel: string;
  cashAccountTitle: string;
  description: string;
  amount: number;
  taxRate: number;
  taxAmount: number;
  netAmount: number;
  cashChange: number;
  documentNumber?: string;
  note?: string;
  taxMode?: TaxMode;
  device?: Device;
}

export async function downloadBookingPdf(state: AppState, data: BookingPdfData): Promise<void> {
  const filename = safeFilename(`${data.documentNumber || "Buchung"}_Buchungsbeleg.pdf`);
  await downloadCanvasPdf(filename, (ctx) => drawBookingPdf(ctx, state, data));
}

export async function downloadBusinessDocumentPdf(state: AppState, document: BusinessDocument): Promise<void> {
  const customer = state.customers.find((item) => item.id === document.customerId);
  const device = state.devices.find((item) => item.id === document.deviceId);
  const type = documentTitle(document);
  const filename = safeFilename(`${document.documentNumber}_${type}.pdf`);
  await downloadCanvasPdf(filename, (ctx) => drawBusinessDocumentPdf(ctx, state, document, customer, device));
}

async function downloadCanvasPdf(filename: string, draw: (ctx: CanvasRenderingContext2D) => void): Promise<void> {
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_WIDTH;
  canvas.height = PAGE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("PDF konnte nicht erstellt werden: Canvas ist nicht verfügbar.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  draw(ctx);

  const jpeg = await canvasToJpeg(canvas);
  const pdf = buildSinglePageJpegPdf(new Uint8Array(await jpeg.arrayBuffer()), PAGE_WIDTH, PAGE_HEIGHT);
  const blob = new Blob([pdf], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

function drawBookingPdf(ctx: CanvasRenderingContext2D, state: AppState, data: BookingPdfData) {
  const settings = state.settings;
  drawBusinessHeader(ctx, settings.businessName, settings.ownerName, settings.street, settings.postalCode, settings.city, settings.taxNumber);
  drawRightTitle(ctx, "Buchungsbeleg", [
    ["Beleg / Buchung Nr.", data.documentNumber || "-"],
    ["Datum", formatDate(data.date)],
  ]);

  let y = 390;
  y = sectionTitle(ctx, "Buchungsdaten", y);
  y = keyValueRows(ctx, y, [
    ["Art", directionLabel(data.direction)],
    ["Zahlungsart", paymentLabel(data.paymentMethod)],
    ["Kassen-/Zahlungskonto", data.cashAccountTitle],
    ["Buchungskonto", `${data.bookingAccountCode} - ${data.bookingAccountLabel}`],
    ["Text", data.description || "-"],
  ]);

  if (data.device) {
    y += 28;
    y = sectionTitle(ctx, "Gerätebezug", y);
    const deviceLines: Array<[string, string]> = [
      ["Gerät", `${data.device.brand} ${data.device.model}`],
      ["IMEI", data.device.imei1 || "-"],
      ["Seriennummer", data.device.serialNumber || "-"],
      ["Bestandsnummer", data.device.stockNumber || "-"],
    ];
    y = keyValueRows(ctx, y, deviceLines);
  }

  y += 34;
  y = sectionTitle(ctx, "Beträge", y);
  y = amountRows(ctx, y, [
    ["Brutto", data.amount],
    ["MwSt.", data.taxAmount],
    ["Netto", data.netAmount],
    ["Kassenwirkung", data.cashChange],
  ], data.taxRate ? `${data.taxRate} %` : "0 %");

  if (data.taxMode === "differential") {
    y += 24;
    y = noteBox(ctx, y, "Steuerhinweis", "Differenzbesteuerung nach § 25a UStG. Bei einem Ankauf wird keine Vorsteuer aus dem Ankaufspreis abgezogen.");
  }

  if (data.note) {
    y += 20;
    y = noteBox(ctx, y, "Notiz", data.note);
  }

  drawFooter(ctx, settings.businessName, settings.email, settings.iban, "Automatisch erzeugter Buchungsbeleg aus Kassenbuch Pro.");
}

function drawBusinessDocumentPdf(
  ctx: CanvasRenderingContext2D,
  state: AppState,
  document: BusinessDocument,
  customer?: Customer,
  device?: Device,
) {
  const settings = state.settings;
  const title = documentTitle(document);
  drawBusinessHeader(ctx, settings.businessName, settings.ownerName, settings.street, settings.postalCode, settings.city, settings.taxNumber);
  drawRightTitle(ctx, title, [
    ["Nummer", document.documentNumber],
    ["Datum", formatDate(document.date)],
  ]);

  let y = 390;
  if (customer) {
    y = sectionTitle(ctx, document.type === "purchaseContract" ? "Verkäufer" : "Kunde", y);
    y = keyValueRows(ctx, y, [
      ["Name", customer.company || `${customer.firstName} ${customer.lastName}`.trim()],
      ["Adresse", [customer.street, [customer.postalCode, customer.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "-"],
      ["Kundennummer", customer.customerNumber || "-"],
    ]);
    y += 25;
  }

  y = sectionTitle(ctx, "Dokument", y);
  const rows: Array<[string, string]> = [
    ["Dokumentart", title],
    ["Zahlungsart", document.paymentMethod ? paymentLabel(document.paymentMethod) : "-"],
    ["Status", document.status],
  ];
  if (device) {
    rows.push(["Gerät", `${device.brand} ${device.model}`]);
    rows.push(["IMEI", device.imei1 || "-"]);
    if (device.serialNumber) rows.push(["Seriennummer", device.serialNumber]);
    if (device.storage) rows.push(["Speicher", device.storage]);
    if (device.color) rows.push(["Farbe", device.color]);
  }
  y = keyValueRows(ctx, y, rows);

  y += 32;
  y = sectionTitle(ctx, "Betrag", y);
  y = amountRows(ctx, y, [
    ["Gesamtbetrag", document.amount],
    ["Enthaltene Steuer", document.taxAmount],
    ["Netto / Bemessung", Math.max(0, document.amount - document.taxAmount)],
  ], document.taxMode === "standard19" ? "19 %" : document.taxMode === "differential" ? "§25a" : "0 %");

  if (document.type === "purchaseContract") {
    y += 28;
    y = noteBox(
      ctx,
      y,
      "Erklärung des Verkäufers",
      "Der Verkäufer bestätigt, dass das bezeichnete Gerät sein Eigentum ist, frei von Rechten Dritter übergeben wird und nicht aus einer Straftat stammt.",
    );
    y += 50;
    signatureLines(ctx, y, ["Ort, Datum", "Unterschrift Verkäufer", "Unterschrift Käufer"]);
  } else if (document.taxMode === "differential") {
    y += 24;
    noteBox(ctx, y, "Steuerhinweis", "Besteuerung nach § 25a UStG. Die Umsatzsteuer wird nicht gesondert ausgewiesen.");
  }

  drawFooter(ctx, settings.businessName, settings.email, settings.iban, "Direkt als PDF aus Kassenbuch Pro gespeichert.");
}

function drawBusinessHeader(
  ctx: CanvasRenderingContext2D,
  businessName: string,
  ownerName: string,
  street: string,
  postalCode: string,
  city: string,
  taxNumber: string,
) {
  ctx.fillStyle = "#111827";
  ctx.font = "700 34px Arial";
  ctx.fillText(businessName || "Kassenbuch Pro", 90, 105);
  ctx.font = "22px Arial";
  ctx.fillStyle = "#475569";
  const lines = [ownerName, street, [postalCode, city].filter(Boolean).join(" "), taxNumber ? `Steuernummer: ${taxNumber}` : ""].filter(Boolean);
  lines.forEach((line, index) => ctx.fillText(line, 90, 150 + index * 31));
  ctx.strokeStyle = "#0f766e";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(90, 295);
  ctx.lineTo(1150, 295);
  ctx.stroke();
}

function drawRightTitle(ctx: CanvasRenderingContext2D, title: string, lines: Array<[string, string]>) {
  ctx.textAlign = "right";
  ctx.fillStyle = "#111827";
  ctx.font = "700 42px Arial";
  ctx.fillText(title, 1150, 105);
  let y = 165;
  for (const [label, value] of lines) {
    ctx.font = "18px Arial";
    ctx.fillStyle = "#64748b";
    ctx.fillText(label, 1150, y);
    ctx.font = "700 21px Arial";
    ctx.fillStyle = "#111827";
    ctx.fillText(value, 1150, y + 27);
    y += 64;
  }
  ctx.textAlign = "left";
}

function sectionTitle(ctx: CanvasRenderingContext2D, title: string, y: number): number {
  ctx.fillStyle = "#0f766e";
  ctx.font = "700 25px Arial";
  ctx.fillText(title, 90, y);
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(90, y + 14);
  ctx.lineTo(1150, y + 14);
  ctx.stroke();
  return y + 52;
}

function keyValueRows(ctx: CanvasRenderingContext2D, y: number, rows: Array<[string, string]>): number {
  for (const [label, value] of rows) {
    ctx.fillStyle = "#64748b";
    ctx.font = "18px Arial";
    ctx.fillText(label, 100, y);
    ctx.fillStyle = "#111827";
    ctx.font = "700 20px Arial";
    drawWrappedText(ctx, value || "-", 420, y, 710, 28);
    y += 46;
  }
  return y;
}

function amountRows(ctx: CanvasRenderingContext2D, y: number, rows: Array<[string, number]>, taxLabel: string): number {
  ctx.font = "18px Arial";
  ctx.fillStyle = "#64748b";
  ctx.fillText("Steuerbehandlung", 100, y);
  ctx.textAlign = "right";
  ctx.fillStyle = "#111827";
  ctx.font = "700 20px Arial";
  ctx.fillText(taxLabel, 1130, y);
  ctx.textAlign = "left";
  y += 46;

  for (const [label, value] of rows) {
    ctx.fillStyle = "#64748b";
    ctx.font = "18px Arial";
    ctx.fillText(label, 100, y);
    ctx.textAlign = "right";
    ctx.fillStyle = value < 0 ? "#b91c1c" : "#111827";
    ctx.font = "700 22px Arial";
    ctx.fillText(formatCurrency(value), 1130, y);
    ctx.textAlign = "left";
    y += 48;
  }
  return y;
}

function noteBox(ctx: CanvasRenderingContext2D, y: number, title: string, text: string): number {
  const lines = wrapText(ctx, text, 980);
  const height = 64 + lines.length * 28;
  ctx.fillStyle = "#f8fafc";
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 2;
  roundedRect(ctx, 90, y, 1060, height, 12);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#111827";
  ctx.font = "700 19px Arial";
  ctx.fillText(title, 115, y + 34);
  ctx.font = "18px Arial";
  ctx.fillStyle = "#334155";
  lines.forEach((line, index) => ctx.fillText(line, 115, y + 68 + index * 28));
  return y + height;
}

function signatureLines(ctx: CanvasRenderingContext2D, y: number, labels: string[]) {
  const gap = 28;
  const width = (1060 - gap * (labels.length - 1)) / labels.length;
  labels.forEach((label, index) => {
    const x = 90 + index * (width + gap);
    ctx.strokeStyle = "#475569";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + width, y);
    ctx.stroke();
    ctx.fillStyle = "#64748b";
    ctx.font = "15px Arial";
    ctx.fillText(label, x, y + 26);
  });
}

function drawFooter(ctx: CanvasRenderingContext2D, businessName: string, email: string, iban: string, note: string) {
  const y = 1630;
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(90, y);
  ctx.lineTo(1150, y);
  ctx.stroke();
  ctx.font = "15px Arial";
  ctx.fillStyle = "#64748b";
  ctx.fillText([businessName, email, iban ? `IBAN: ${iban}` : ""].filter(Boolean).join(" · "), 90, y + 34);
  ctx.font = "13px Arial";
  ctx.fillText(note, 90, y + 62);
}

function drawWrappedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const lines = wrapText(ctx, text, maxWidth);
  lines.slice(0, 3).forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || !current) current = next;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function documentTitle(document: BusinessDocument): string {
  if (document.type === "invoice") return "Rechnung";
  if (document.type === "receipt") return "Quittung";
  if (document.type === "estimate") return "Kostenvoranschlag";
  if (document.type === "purchaseContract") return "Ankaufvertrag";
  if (document.type === "zReport") return "Tagesabschluss";
  return "Eingangsrechnung";
}

function directionLabel(direction: LedgerDirection): string {
  if (direction === "income") return "Einnahme";
  if (direction === "expense") return "Ausgabe";
  return "Umbuchung / Fremdgeld";
}

function paymentLabel(payment: PaymentMethod): string {
  if (payment === "cash") return "Bar / Kasse";
  if (payment === "card") return "Karte";
  if (payment === "bank") return "Bank";
  return "PayPal";
}

function safeFilename(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").replace(/\s+/g, "_");
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PDF-Bild konnte nicht erzeugt werden.")), "image/jpeg", 0.94);
  });
}

export function buildSinglePageJpegPdf(jpeg: Uint8Array, width: number, height: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0];
  let length = 0;
  const encoder = new TextEncoder();

  const push = (value: string | Uint8Array) => {
    const bytes = typeof value === "string" ? encoder.encode(value) : value;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: () => void) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    body();
    push("\nendobj\n");
  };

  push("%PDF-1.4\n%KassenbuchPro\n");
  object(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
  object(2, () => push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"));
  object(3, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_WIDTH} ${PDF_HEIGHT}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`));
  object(4, () => {
    push(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
    push(jpeg);
    push("\nendstream");
  });
  const content = `q\n${PDF_WIDTH} 0 0 ${PDF_HEIGHT} 0 0 cm\n/Im0 Do\nQ\n`;
  object(5, () => push(`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`));

  const xrefOffset = length;
  push("xref\n0 6\n");
  push("0000000000 65535 f \n");
  for (let id = 1; id <= 5; id += 1) {
    push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  }
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const result = new Uint8Array(length);
  let cursor = 0;
  for (const chunk of chunks) {
    result.set(chunk, cursor);
    cursor += chunk.length;
  }
  return result;
}
