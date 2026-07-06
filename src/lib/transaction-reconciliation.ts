import type { AppState, BusinessDocument, ImportedTransaction } from "./types";

export function reconcileImportedState(current: AppState): { state: AppState; matched: number } {
  let matched = 0;
  const matchedLedgerIds = new Set<string>();
  const importedTransactions = current.importedTransactions.map((transaction) => {
    if (transaction.status === "matched" || transaction.status === "ignored") return transaction;
    if (transaction.transactionType === "refund") {
      return { ...transaction, status: "needsReview" as const, matchConfidence: 0 };
    }
    const candidates = current.documents
      .filter((document) => documentFitsTransaction(document, transaction))
      .map((document) => ({ document, score: scoreDocument(document, transaction) }))
      .sort((left, right) => right.score - left.score);
    const best = candidates[0];
    const second = candidates[1];
    const ambiguous = Boolean(second && best && second.score === best.score);
    if (!best || best.score < 85 || ambiguous) {
      return { ...transaction, matchConfidence: best?.score ?? 0, status: "needsReview" as const };
    }
    const ledgerEntry = current.ledger.find((entry) => entry.documentId === best.document.id);
    if (ledgerEntry) matchedLedgerIds.add(ledgerEntry.id);
    matched += 1;
    return {
      ...transaction,
      matchedDocumentId: best.document.id,
      matchedLedgerEntryId: ledgerEntry?.id,
      matchConfidence: Math.min(100, best.score),
      status: "matched" as const,
    };
  });
  return {
    matched,
    state: {
      ...current,
      importedTransactions,
      ledger: current.ledger.map((entry) =>
        matchedLedgerIds.has(entry.id) ? { ...entry, reconciled: true } : entry,
      ),
    },
  };
}

function documentFitsTransaction(document: BusinessDocument, transaction: ImportedTransaction): boolean {
  if (transaction.transactionType === "bankFunding" || transaction.transactionType === "bankWithdrawal") return false;
  if (transaction.amount < 0) return document.type === "supplierInvoice" || document.type === "purchaseContract";
  return document.type === "invoice" || document.type === "receipt";
}

function scoreDocument(document: BusinessDocument, transaction: ImportedTransaction): number {
  let score = 0;
  if (Math.abs(document.amount - Math.abs(transaction.amount)) < 0.01) score += 60;
  const dateDistance = Math.abs(new Date(`${document.date}T12:00:00`).getTime() - new Date(`${transaction.date}T12:00:00`).getTime());
  if (dateDistance <= 3 * 86_400_000) score += 20;
  else if (dateDistance <= 7 * 86_400_000) score += 10;
  const expectedPayment = transaction.accountType === "paypal" ? "paypal" : "bank";
  if (document.paymentMethod === expectedPayment) score += 10;
  const transactionInvoice = normalizeText(transaction.invoiceNumber || "");
  const documentInvoice = normalizeText(String(document.metadata?.invoiceNumber || document.documentNumber || ""));
  if (transactionInvoice && documentInvoice && (transactionInvoice === documentInvoice || transactionInvoice.includes(documentInvoice) || documentInvoice.includes(transactionInvoice))) score += 20;
  const counterparty = normalizeText(transaction.counterparty || transaction.description);
  const vendor = normalizeText(String(document.metadata?.vendor || ""));
  if (counterparty && vendor && (counterparty.includes(vendor) || vendor.includes(counterparty))) score += 10;
  return score;
}

function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
