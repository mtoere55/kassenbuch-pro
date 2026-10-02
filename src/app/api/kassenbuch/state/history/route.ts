import { NextRequest, NextResponse } from "next/server";
import { requireCidFromRequest } from "@/lib/server-cid-request";
import { listStateHistory } from "@/lib/server-cid-storage";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const cid = requireCidFromRequest(request);
    const history = await listStateHistory(cid);
    return NextResponse.json(
      { cid, history },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Server-Sicherungsverlauf konnte nicht gelesen werden.";
    return NextResponse.json(
      { error: message },
      { status: message === "Keine aktive Cidentia Sitzung." ? 401 : 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
