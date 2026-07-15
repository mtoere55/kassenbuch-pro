import { NextRequest, NextResponse } from "next/server";
import { CidentiaOtpError, sendCidentiaOtp } from "@/lib/cidentia-otp";
import { assertOtpRateLimit, OtpRateLimitError } from "@/lib/otp-rate-limit";
import { assertSameOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const body = (await request.json()) as { email?: unknown };
    const email = typeof body.email === "string" ? body.email : "";
    assertOtpRateLimit(request, "send", email);
    const message = await sendCidentiaOtp(email);
    return NextResponse.json(
      { message },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (cause) {
    const status = errorStatus(cause);
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (cause instanceof OtpRateLimitError) {
      headers["Retry-After"] = String(cause.retryAfterSeconds);
    }
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Bestätigungscode konnte nicht gesendet werden." },
      { status, headers },
    );
  }
}

function errorStatus(cause: unknown): number {
  if (cause instanceof OtpRateLimitError) return cause.status;
  if (cause instanceof CidentiaOtpError) return cause.status;
  return 400;
}
