"use client";

import { useEffect, useState } from "react";
import { getTaxAmountFromGross, makeId, nextSequence, todayIso } from "@/lib/accounting";
import {
  findSupplierInvoiceDuplicate,
  getSupplierAccount,
  inferSupplierAccount,
  supplierInvoiceDuplicateKey,
} from "@/lib/document-control";
import { detectDocumentType, parseSupplierInvoice, parseZReport, type ParsedInvoice, type ParsedZReport } from "@/lib/document-parser";
import { createArchiveImageDataUrl, prepareImageForOcr } from "@/lib/image-ocr";
import { validateSupplierInvoiceAmounts } from "@/lib/invoice-validation";
import { readPdfForOcr } from "@/lib/pdf-reader";
import { parseTransactionsCsv, summarizeImportedTransactions } from "@/lib/csv";
import { useKassenStore } from "@/lib/store";
import type { BusinessDocument, ImportedTransaction, LedgerEntry, PaymentMethod } from "@/lib/types";

export type ParsedScan = ParsedZReport | ParsedInvoice;
export type ScanDocumentType = ParsedScan["type"];
type UniversalMode = "document" | "bankCsv" | "paypalCsv";

const MAX_SCAN_BYTES = 20 * 1024 * 1024;
const MAX_INLINE_ARCHIVE_BYTES = 3 * 1024 * 1024;

export function useScannerController() {
  const { state, replaceState, addScannedZReport, importTransactions } = useKassenStore();
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [ocrText, setOcrText] = useState("");
  const [parsed, setParsed] = useState<ParsedScan>();
  const [bookSales, setBookSales] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("bank");
  const [accountCode, setAccountCode] = useState("4980");
  const [invoicePaid, setInvoicePaid] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [scanInfo, setScanInfo] = useState("");
  const [universalMode, setUniversalMode] = useState<UniversalMode>("document");
  const [transactions, setTransactions] = useState<ImportedTransaction[]>([]);

  const isPdf = Boolean(file && (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")));

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function chooseFile(selected?: File) {
    if (!selected) return;
    if (selected.size > MAX_SCAN_BYTES) {
      setError("Die Datei ist größer als 20 MB. Bitte die Datei verkleinern oder teilen.");
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setError("");
    setFile(selected);
    setPreview(selected.type.startsWith("image/") || selected.type === "application/pdf" || selected.name.toLowerCase().endsWith(".pdf") ? URL.createObjectURL(selected) : undefined);
    setParsed(undefined);
    setTransactions([]);
    setUniversalMode("document");
    setOcrText("");
    setMessage("");
    setScanInfo("");
    setProgress(0);
  }

  async function recognizeSources(sources: Array<File | Blob>) {
    const { createWorker } = await import("tesseract.js");
    let activePage = 0;
    const totalPages = Math.max(sources.length, 1);
    const worker = await createWorker(["deu", "eng"], 1, {
      logger: (event) => {
        if (event.status === "recognizing text") {
          const totalProgress = (activePage + (event.progress || 0)) / totalPages;
          setProgress(Math.round(totalProgress * 100));
        }
      },
    });
    try {
      await worker.setParameters({ preserve_interword_spaces: "1" });
      const parts: string[] = [];
      for (let index = 0; index < sources.length; index += 1) {
        activePage = index;
        const result = await worker.recognize(sources[index]);
        if (result.data.text.trim()) parts.push(result.data.text.trim());
      }
      return parts.join("\n");
    } finally {
      await worker.terminate();
    }
  }

  async function scan() {
    if (!file) return;
    setError("");
    setMessage("");
    setStatus("processing");
    setProgress(0);
    setScanInfo("");
    setTransactions([]);
    try {
      const kind = await detectFileKind(file);
      let text = "";
      if (kind === "pdf") {
        const pdf = await readPdfForOcr(file);
        if (pdf.pageImages.length > 0) {
          const recognized = await recognizeSources(pdf.pageImages);
          text = [pdf.embeddedText, recognized].filter(Boolean).join("\n");
          setScanInfo(`${pdf.processedPages} von ${pdf.pageCount} PDF-Seiten wurden als Bild erkannt.`);
        } else {
          text = pdf.embeddedText;
          setProgress(100);
          setScanInfo(`${pdf.processedPages} von ${pdf.pageCount} PDF-Seiten wurden direkt ausgelesen.`);
        }
      } else if (kind === "image") {
        const prepared = await prepareImageForOcr(file);
        text = await recognizeSources(prepared.sources);
        setScanInfo(prepared.message);
      } else {
        text = await file.text();
        setProgress(100);
        setScanInfo("Text/CSV-Datei wurde direkt gelesen.");
      }
      if (!text.trim()) throw new Error("In diesem Dokument konnte kein lesbarer Text erkannt werden.");
      setOcrText(text);

      const transactionGuess = parseUniversalTransactions(text);
      if (transactionGuess.transactions.length) {
        setUniversalMode(transactionGuess.mode);
        setTransactions(transactionGuess.transactions);
        setParsed(undefined);
        const summary = summarizeImportedTransactions(transactionGuess.transactions);
        setMessage(`${summary.total} Kontobewegung(en) erkannt. Mit „Geprüfte Daten übernehmen“ werden sie importiert und danach im Bereich Bank & Zahlungsabgleich geprüft.`);
      } else {
        setUniversalMode("document");
        applyDocumentType(detectDocumentTypeRobust(text), text);
      }
      setStatus("done");
      setProgress(100);
    } catch (cause) {
      setStatus("");
      setError(cause instanceof Error ? cause.message : "Dokument konnte nicht gelesen werden.");
    }
  }

  function applyDocumentType(type: ScanDocumentType, text = ocrText) {
    setTransactions([]);
    setUniversalMode("document");
    if (type === "zReport") {
      setParsed(parseZReport(text));
      return;
    }
    const invoice = parseSupplierInvoice(text);
    setParsed(invoice);
    setAccountCode(inferSupplierAccount(invoice.vendor || "", text).code);
  }

  function updateField(key: string, value: string) {
    setParsed((current) => current ? ({
      ...current,
      [key]: numericFields.has(key) ? Number(value.replace(",", ".")) || 0 : value,
    } as ParsedScan) : current);
  }

  async function originalFileDataUrl() {
    if (!file) return undefined;
    if (file.type.startsWith("image/")) return createArchiveImageDataUrl(file);
    if (file.size > MAX_INLINE_ARCHIVE_BYTES) return undefined;
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function saveSupplierInvoice(invoice: ParsedInvoice, dataUrl?: string) {
    const date = invoice.date || todayIso();
    const vendor = invoice.vendor?.trim() || "Unbekannter Lieferant";
    const gross = invoice.gross || 0;
    const taxCandidate = invoice.vat ?? getTaxAmountFromGross(gross);
    const amounts = validateSupplierInvoiceAmounts(gross, taxCandidate);
    const duplicate = findSupplierInvoiceDuplicate(state.documents, { vendor, date, gross: amounts.gross, invoiceNumber: invoice.invoiceNumber, fileName: file?.name });
    if (duplicate) throw new Error(`Diese Rechnung ist bereits als ${duplicate.documentNumber} gespeichert. Bitte die vorhandene Rechnung öffnen oder zuerst löschen.`);

    const createdAt = new Date().toISOString();
    const documentId = makeId("document");
    const documentNumber = invoice.invoiceNumber?.trim() || nextSequence("ER", state.documents.map((document) => document.documentNumber), new Date(`${date}T12:00:00`));
    const account = getSupplierAccount(accountCode);
    const duplicateKey = supplierInvoiceDuplicateKey({ vendor, date, gross: amounts.gross, invoiceNumber: invoice.invoiceNumber, fileName: file?.name });
    const document: BusinessDocument = {
      id: documentId,
      documentNumber,
      type: "supplierInvoice",
      date,
      amount: amounts.gross,
      taxAmount: amounts.vat,
      taxMode: amounts.vat > 0 ? "standard19" : "taxFree",
      paymentMethod,
      status: invoicePaid ? "paid" : "open",
      originalFileName: file?.name,
      originalImageDataUrl: dataUrl,
      ocrText,
      metadata: { vendor, invoiceNumber: invoice.invoiceNumber || null, accountCode: account.code, accountLabel: account.label, duplicateKey, automaticallyBooked: true, universalImport: true },
      createdAt,
    };
    const paymentAccount = { cash: "1000", card: "1360", bank: "1200", paypal: "1370" }[paymentMethod];
    const ledgerEntry: LedgerEntry = {
      id: makeId("ledger"), date, direction: "expense", amount: amounts.gross, paymentMethod,
      description: `Eingangsrechnung ${vendor}`, category: `${account.code} · ${account.label}`,
      source: "scan", sourceId: documentId, documentId, taxAmount: amounts.vat, taxRate: amounts.vat > 0 ? 19 : 0,
      taxMode: amounts.vat > 0 ? "standard19" : "taxFree", reconciled: invoicePaid && (paymentMethod === "cash" || paymentMethod === "card"),
      accountCode: account.code, counterAccountCode: paymentAccount, documentNumber,
      cashChange: paymentMethod === "cash" && invoicePaid ? -amounts.gross : 0,
      netAmount: amounts.net, attachmentFileName: file?.name, attachmentDataUrl: dataUrl, createdAt,
    };
    replaceState({ ...state, documents: [document, ...state.documents], ledger: [ledgerEntry, ...state.ledger] });
  }

  async function save() {
    setError("");
    try {
      if (transactions.length) {
        const added = importTransactions(transactions);
        setMessage(`${added} neue Kontobewegung(en) wurden universell importiert. Danach bitte Bank & Zahlungsabgleich öffnen und prüfen.`);
        setTransactions([]);
        return;
      }
      if (!parsed) return;
      const dataUrl = await originalFileDataUrl();
      const archiveNote = file && !dataUrl ? " Die Originaldatei ist für den lokalen Demo-Speicher zu groß; Dateiname und OCR-Text wurden gespeichert." : "";
      if (parsed.type === "zReport") {
        if (!parsed.gross && !parsed.cash && !parsed.card) throw new Error("Bitte Brutto, Bar oder Karte kontrollieren. Ohne Umsatzwert kann der Tagesabschluss nicht gespeichert werden.");
        addScannedZReport({ date: parsed.date || todayIso(), zNumber: parsed.zNumber, gross: parsed.gross || 0, net: parsed.net, vat: parsed.vat, cash: parsed.cash || 0, card: parsed.card || 0, salesCount: parsed.salesCount, difference: parsed.difference, imageDataUrl: dataUrl, fileName: file?.name, ocrText, bookSales });
        setMessage((bookSales ? "Tagesabschluss archiviert und Umsatz gebucht." : "Tagesabschluss archiviert und nur zum Abgleich gespeichert.") + archiveNote);
      } else {
        await saveSupplierInvoice(parsed, dataUrl);
        const account = getSupplierAccount(accountCode);
        setMessage(`Beleg gespeichert und auf ${account.code} ${account.label} in die Buchhaltung übernommen.` + archiveNote);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Dokument konnte nicht gespeichert werden.");
    }
  }

  return {
    file, preview, progress, isProcessing: status === "processing", isPdf, ocrText, parsed, bookSales, paymentMethod, accountCode, invoicePaid, message, error, scanInfo,
    transactionSummary: transactions.length ? `${transactions.length} Kontobewegung(en) · ${universalMode === "paypalCsv" ? "Zahlungsdienstleister" : "Bank/Konto"}` : "",
    differenceWarning: parsed?.type === "zReport" && Boolean(parsed.difference), incompleteWarning: parsed ? getIncompleteWarning(parsed) : "",
    chooseFile, scan, save, applyDocumentType, updateField, setBookSales, setPaymentMethod, setAccountCode, setInvoicePaid,
  };
}

const numericFields = new Set(["gross", "net", "vat", "cash", "card", "salesCount", "openingCash", "expectedCash", "countedCash", "difference"]);

async function detectFileKind(file: File): Promise<"pdf" | "image" | "text"> {
  if (file.type.startsWith("image/")) return "image";
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (/\.(csv|txt|tsv|xml)$/i.test(name) || file.type.startsWith("text/")) return "text";
  const header = String.fromCharCode(...new Uint8Array(await file.slice(0, 5).arrayBuffer()));
  return header === "%PDF-" ? "pdf" : "text";
}

function parseUniversalTransactions(text: string): { mode: UniversalMode; transactions: ImportedTransaction[] } {
  const paypal = safeTransactions(text, "paypal");
  const bank = safeTransactions(text, "bank");
  if (paypal.length >= bank.length && paypal.length > 0) return { mode: "paypalCsv", transactions: paypal };
  if (bank.length > 0) return { mode: "bankCsv", transactions: bank };
  return { mode: "document", transactions: [] };
}
function safeTransactions(text: string, type: "bank" | "paypal") { try { return parseTransactionsCsv(text, type); } catch { return []; } }
function detectDocumentTypeRobust(text: string): ScanDocumentType { const direct = detectDocumentType(text); if (direct === "zReport") return direct; const normalized = text.toLowerCase(); const hints = [/tages.?abschluss/, /z.?bericht/, /verkaufs.?ubersicht/, /zahlungs.?ubersicht/, /erwartetes.?bargeld/, /gezahlter.?bargeldbestand/, /anzahl.?verkaufe/]; const score = hints.reduce((sum, pattern) => sum + (pattern.test(normalized) ? 1 : 0), 0); return score >= 2 ? "zReport" : "supplierInvoice"; }
function getIncompleteWarning(parsed: ParsedScan): string { if (parsed.type === "zReport") return !parsed.gross && !parsed.cash && !parsed.card ? "Die Umsatzwerte wurden nicht sicher erkannt. Bitte Dokumenttyp prüfen und Brutto, Bar sowie Karte manuell kontrollieren." : ""; if (!parsed.gross) return "Der Rechnungsbetrag wurde nicht sicher erkannt. Bitte Brutto und MwSt. vor dem Speichern manuell eintragen."; if (parsed.vat && parsed.vat >= parsed.gross) return "Die erkannte MwSt. ist offensichtlich falsch. Bitte den Steuerbetrag vor dem Speichern korrigieren."; return ""; }
