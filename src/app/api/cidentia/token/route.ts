import { NextRequest, NextResponse } from "next/server";
import { exchangeCidentiaCode } from "@/lib/cidentia-server";

const STATE_COOKIE = "kassenbuch-cidentia-state";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { code?: string; state?: string };
    const expectedState = request.cookies.get(STATE_COOKIE)?.value;
    if (expectedState && body.state && expectedState !== body.state) {
      return NextResponse.json({ error: "Cidentia State stimmt nicht überein." }, { status: 400 });
    }
    const session = await exchangeCidentiaCode({ code: body.code || "", requestUrl: request.url });
    const response = NextResponse.json({ session });
    response.cookies.delete(STATE_COOKIE);
    return response;
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Cidentia Token konnte nicht geprüft werden." },
      { status: 400 },
    );
  }
}
