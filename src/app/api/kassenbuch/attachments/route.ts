import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/request-origin";
import { requireCidFromRequest } from "@/lib/server-cid-request";
import {
  listAttachments,
  readAttachment,
  writeAttachmentChunk,
  type AttachmentChunkInput,
} from "@/lib/server-cid-storage";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const cid = requireCidFromRequest(request);
    const key = request.nextUrl.searchParams.get("key");
    if (!key) {
      const items = await listAttachments(cid);
      return NextResponse.json(
        { cid, items },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    assertCidAttachmentKey(cid, key);
    const record = await readAttachment(cid, key);
    if (!record) {
      return NextResponse.json(
        { error: "Dokumentdatei wurde auf dem Server nicht gefunden." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    return new NextResponse(record.value, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Kassenbuch-Attachment-Key": encodeURIComponent(record.item.key),
        "X-Kassenbuch-Attachment-Sha256": record.item.sha256,
      },
    });
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function PUT(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const cid = requireCidFromRequest(request);
    const input = await request.json() as AttachmentChunkInput;
    assertCidAttachmentKey(cid, input.key);
    const result = await writeAttachmentChunk(cid, input);
    return NextResponse.json(
      { success: true, ...result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (cause) {
    return errorResponse(cause);
  }
}

function assertCidAttachmentKey(cid: string, key: string): void {
  if (!key.startsWith(`cid:${cid}:`)) {
    throw new Error("Dokumentdatei gehört nicht zur aktiven CID.");
  }
}

function errorResponse(cause: unknown) {
  const message = cause instanceof Error ? cause.message : "Dokument-Synchronisierung ist fehlgeschlagen.";
  const status = message === "Keine aktive Cidentia Sitzung." ? 401 : 500;
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
