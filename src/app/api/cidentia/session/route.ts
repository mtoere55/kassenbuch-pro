import { NextRequest, NextResponse } from "next/server";
import {
  CIDENTIA_SESSION_COOKIE,
  expiredCidentiaSessionCookieOptions,
  readCidentiaSessionCookie,
} from "@/lib/cidentia-cookie-session";
import { cidentiaStoragePolicy } from "@/lib/cidentia-storage-policy";
import { assertSameOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = readCidentiaSessionCookie(request.cookies.get(CIDENTIA_SESSION_COOKIE)?.value);
  if (!session) {
    const response = NextResponse.json(
      { error: "Keine aktive Cidentia Sitzung." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(CIDENTIA_SESSION_COOKIE, "", expiredCidentiaSessionCookieOptions());
    return response;
  }

  return NextResponse.json(
    { session, storagePolicy: cidentiaStoragePolicy() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const response = NextResponse.json(
      { success: true },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(CIDENTIA_SESSION_COOKIE, "", expiredCidentiaSessionCookieOptions());
    return response;
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Abmeldung ist fehlgeschlagen." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
