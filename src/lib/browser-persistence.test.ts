import { describe, expect, it } from "vitest";
import {
  mergeStateWithBrowserAttachments,
  splitStateForBrowserStorage,
} from "./browser-persistence";
import type { AppState } from "./types";

describe("browser persistence", () => {
  it("keeps large document payloads out of localStorage and restores them", () => {
    const state = makeState();
    const split = splitStateForBrowserStorage(state);

    expect(split.compactState.documents[0].originalImageDataUrl).toBeUndefined();
    expect(split.compactState.documents[0].ocrText).toBeUndefined();
    expect(split.compactState.ledger[0].attachmentDataUrl).toBeUndefined();
    expect(JSON.stringify(split.compactState)).not.toContain("data:application/pdf");
    expect(split.attachments).toHaveLength(2);

    const restored = mergeStateWithBrowserAttachments(split.compactState, split.attachments);
    expect(restored.documents[0].originalImageDataUrl).toBe("data:application/pdf;base64,AAAA");
    expect(restored.documents[0].ocrText).toBe("Sehr langer OCR Text");
    expect(restored.ledger[0].attachmentDataUrl).toBe("data:application/pdf;base64,AAAA");
  });

  it("stores a ledger-only attachment separately", () => {
    const state = makeState();
    state.ledger[0].documentId = undefined;
    state.ledger[0].attachmentDataUrl = "data:image/jpeg;base64,BBBB";

    const split = splitStateForBrowserStorage(state);
    expect(split.attachments.map((item) => item.key)).toContain("ledger:ledger-1:data");
    const restored = mergeStateWithBrowserAttachments(split.compactState, split.attachments);
    expect(restored.ledger[0].attachmentDataUrl).toBe("data:image/jpeg;base64,BBBB");
  });
});

function makeState(): AppState {
  return {
    version: 1,
    customers: [],
    devices: [],
    purchases: [],
    sales: [],
    documents: [
      {
        id: "document-1",
        documentNumber: "BANK-1",
        type: "zReport",
        date: "2026-06-30",
        amount: 100,
        taxAmount: 0,
        taxMode: "taxFree",
        status: "archived",
        originalImageDataUrl: "data:application/pdf;base64,AAAA",
        ocrText: "Sehr langer OCR Text",
        createdAt: "2026-06-30T12:00:00.000Z",
      },
    ],
    ledger: [
      {
        id: "ledger-1",
        date: "2026-06-30",
        direction: "income",
        amount: 100,
        paymentMethod: "bank",
        description: "Test",
        category: "1200 · Bank",
        source: "bankImport",
        documentId: "document-1",
        taxAmount: 0,
        taxRate: 0,
        taxMode: "taxFree",
        reconciled: true,
        attachmentDataUrl: "data:application/pdf;base64,AAAA",
        createdAt: "2026-06-30T12:00:00.000Z",
      },
    ],
    importedTransactions: [],
    settings: {
      businessName: "Test",
      ownerName: "Test",
      street: "",
      postalCode: "",
      city: "",
      phone: "",
      email: "",
      taxNumber: "",
      vatId: "",
      iban: "",
      invoicePrefix: "RE",
      receiptPrefix: "QU",
      purchasePrefix: "ANK",
      currency: "EUR",
      language: "de",
      openingCash: 0,
    },
  };
}
