import { NextRequest, NextResponse } from "next/server";
import { sendCidentiaOtp } from "@/lib/cidentia-otp";
import { assertSameOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const body = (await request.json()) as { email?: string };
    const message = await sendCidentiaOtp(body.email || "");
    return NextResponse.json(
      { message },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Bestätigungscode konnte nicht gesendet werden." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
