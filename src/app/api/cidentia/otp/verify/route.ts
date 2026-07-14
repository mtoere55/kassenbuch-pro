import { NextRequest, NextResponse } from "next/server";
import {
  CIDENTIA_SESSION_COOKIE,
  cidentiaSessionCookieOptions,
  createCidentiaSessionCookie,
} from "@/lib/cidentia-cookie-session";
import { verifyCidentiaOtp } from "@/lib/cidentia-otp";
import { assertSameOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const body = (await request.json()) as { email?: string; code?: string };
    const session = await verifyCidentiaOtp(body.email || "", body.code || "");
    const response = NextResponse.json(
      { session },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(
      CIDENTIA_SESSION_COOKIE,
      createCidentiaSessionCookie(session),
      cidentiaSessionCookieOptions(),
    );
    return response;
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Cidentia Anmeldung ist fehlgeschlagen." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
