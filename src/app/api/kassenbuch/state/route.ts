import { gunzipSync } from "node:zlib";
import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/request-origin";
import { requireCidFromRequest } from "@/lib/server-cid-request";
import {
  isRevisionConflict,
  readServerState,
  writeServerState,
} from "@/lib/server-cid-storage";
import type { AppState } from "@/lib/types";

export const runtime = "nodejs";

interface StateWritePayload {
  baseRevision: number | null;
  state: AppState;
}

export async function GET(request: NextRequest) {
  try {
    const cid = requireCidFromRequest(request);
    const snapshot = await readServerState(cid);
    if (!snapshot) {
      return NextResponse.json(
        { exists: false, cid },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      {
        exists: true,
        cid,
        revision: snapshot.revision,
        updatedAt: snapshot.updatedAt,
        state: snapshot.state,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function PUT(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const cid = requireCidFromRequest(request);
    const payload = await readPayload(request);
    if (!("baseRevision" in payload) || !("state" in payload)) {
      throw new Error("Unvollständiger Server-Sync-Datensatz.");
    }
    if (payload.baseRevision !== null && (!Number.isInteger(payload.baseRevision) || payload.baseRevision < 1)) {
      throw new Error("Ungültige Basisrevision.");
    }

    const snapshot = await writeServerState(cid, payload.state, payload.baseRevision);
    return NextResponse.json(
      {
        success: true,
        cid,
        revision: snapshot.revision,
        updatedAt: snapshot.updatedAt,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (cause) {
    if (isRevisionConflict(cause)) {
      return NextResponse.json(
        {
          error: "Die Serverdaten wurden bereits in einem anderen Browser geändert.",
          code: "REVISION_CONFLICT",
          currentRevision: cause.currentRevision ?? null,
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    return errorResponse(cause);
  }
}

async function readPayload(request: NextRequest): Promise<StateWritePayload> {
  const bytes = Buffer.from(await request.arrayBuffer());
  const decoded = request.headers.get("content-encoding") === "gzip"
    ? gunzipSync(bytes)
    : bytes;
  if (decoded.byteLength > 12 * 1024 * 1024) {
    throw new Error("Der Server-Sync-Datensatz ist zu groß.");
  }
  return JSON.parse(decoded.toString("utf8")) as StateWritePayload;
}

function errorResponse(cause: unknown) {
  const message = cause instanceof Error ? cause.message : "Serversynchronisierung ist fehlgeschlagen.";
  const status = message === "Keine aktive Cidentia Sitzung." ? 401 : 500;
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
