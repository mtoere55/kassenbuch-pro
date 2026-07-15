import { NextRequest, NextResponse } from "next/server";
import {
  CIDENTIA_SESSION_COOKIE,
  cidentiaSessionCookieOptions,
  createCidentiaSessionCookie,
} from "@/lib/cidentia-cookie-session";
import { CidentiaOtpError, verifyCidentiaOtp } from "@/lib/cidentia-otp";
import { cidentiaStoragePolicy } from "@/lib/cidentia-storage-policy";
import { assertOtpRateLimit, OtpRateLimitError } from "@/lib/otp-rate-limit";
import { assertSameOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const body = (await request.json()) as { email?: unknown; code?: unknown };
    const email = typeof body.email === "string" ? body.email : "";
    const code = typeof body.code === "string" ? body.code : "";
    assertOtpRateLimit(request, "verify", email);
    const session = await verifyCidentiaOtp(email, code);
    const response = NextResponse.json(
      { session, storagePolicy: cidentiaStoragePolicy() },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(
      CIDENTIA_SESSION_COOKIE,
      createCidentiaSessionCookie(session),
      cidentiaSessionCookieOptions(),
    );
    return response;
  } catch (cause) {
    const status = errorStatus(cause);
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (cause instanceof OtpRateLimitError) {
      headers["Retry-After"] = String(cause.retryAfterSeconds);
    }
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Cidentia Anmeldung ist fehlgeschlagen." },
      { status, headers },
    );
  }
}

function errorStatus(cause: unknown): number {
  if (cause instanceof OtpRateLimitError) return cause.status;
  if (cause instanceof CidentiaOtpError) return cause.status;
  return 400;
}
