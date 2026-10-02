import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isRevisionConflict,
  listAttachments,
  listStateHistory,
  readAttachment,
  readServerState,
  writeAttachmentChunk,
  writeServerState,
} from "./server-cid-storage";
import type { AppState } from "./types";

describe("CID server storage", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "kassenbuch-cid-storage-"));
    process.env.KASSENBUCH_DATA_DIR = tempDir;
  });

  afterEach(async () => {
    delete process.env.KASSENBUCH_DATA_DIR;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it("stores one authoritative state per CID and keeps revision history", async () => {
    const first = stateWithBusiness("Suntel Handy Shop");
    const saved1 = await writeServerState("CID-26-00007", first, null);
    expect(saved1.revision).toBe(1);

    const second = stateWithBusiness("Suntel Handy Shop Neu");
    const saved2 = await writeServerState("CID-26-00007", second, 1);
    expect(saved2.revision).toBe(2);

    const current = await readServerState("CID-26-00007");
    expect(current?.state.settings.businessName).toBe("Suntel Handy Shop Neu");
    expect(current?.revision).toBe(2);

    const history = await listStateHistory("CID-26-00007");
    expect(history).toHaveLength(1);
    expect(history[0].revision).toBe(1);

    expect(await readServerState("CID-OTHER-001")).toBeUndefined();
  });

  it("refuses stale browser writes instead of silently overwriting newer data", async () => {
    await writeServerState("CID-26-00007", stateWithBusiness("A"), null);
    await writeServerState("CID-26-00007", stateWithBusiness("B"), 1);

    try {
      await writeServerState("CID-26-00007", stateWithBusiness("STALE"), 1);
      throw new Error("Expected revision conflict");
    } catch (error) {
      expect(isRevisionConflict(error)).toBe(true);
      if (isRevisionConflict(error)) expect(error.currentRevision).toBe(2);
    }

    const current = await readServerState("CID-26-00007");
    expect(current?.state.settings.businessName).toBe("B");
  });

  it("serializes simultaneous writes so only one browser can advance the same revision", async () => {
    await writeServerState("CID-26-00007", stateWithBusiness("BASE"), null);
    const results = await Promise.allSettled([
      writeServerState("CID-26-00007", stateWithBusiness("CHROME"), 1),
      writeServerState("CID-26-00007", stateWithBusiness("FIREFOX"), 1),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const current = await readServerState("CID-26-00007");
    expect(current?.revision).toBe(2);
    expect(["CHROME", "FIREFOX"]).toContain(current?.state.settings.businessName);
  });

  it("reassembles attachment chunks and validates the checksum", async () => {
    const cid = "CID-26-00007";
    const key = "cid:CID-26-00007:document:doc-1:data";
    const value = "data:application/pdf;base64,AAAA-BBBB-CCCC";
    const sha256 = createHash("sha256").update(value, "utf8").digest("hex");
    const chunks = [value.slice(0, 20), value.slice(20)];

    const first = await writeAttachmentChunk(cid, {
      key,
      uploadId: "uploadtest01",
      index: 0,
      total: 2,
      chunk: chunks[0],
      sha256,
    });
    expect(first.complete).toBe(false);

    const second = await writeAttachmentChunk(cid, {
      key,
      uploadId: "uploadtest01",
      index: 1,
      total: 2,
      chunk: chunks[1],
      sha256,
    });
    expect(second.complete).toBe(true);
    expect(second.item?.sha256).toBe(sha256);

    const manifest = await listAttachments(cid);
    expect(manifest).toHaveLength(1);
    expect(manifest[0].key).toBe(key);

    const restored = await readAttachment(cid, key);
    expect(restored?.value).toBe(value);
  });
});

function stateWithBusiness(businessName: string): AppState {
  return {
    version: 1,
    customers: [],
    devices: [],
    purchases: [],
    sales: [],
    repairs: [],
    documents: [],
    ledger: [],
    importedTransactions: [],
    settings: {
      businessName,
      ownerName: "Ali Sun",
      street: "Badstr. 6",
      postalCode: "58095",
      city: "Hagen",
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
