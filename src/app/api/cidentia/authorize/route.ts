import { NextRequest, NextResponse } from "next/server";
import { cidentiaApiBase, cidentiaRedirectUri, requireCidentiaClientId } from "@/lib/cidentia-server";

const STATE_COOKIE = "kassenbuch-cidentia-state";

export async function GET(request: NextRequest) {
  try {
    const clientId = requireCidentiaClientId();
    const redirectUri = cidentiaRedirectUri(request.url);
    const state = crypto.randomUUID();
    const url = new URL(`${cidentiaApiBase()}/oauth/authorize`);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);

    const response = NextResponse.redirect(url);
    response.cookies.set(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: new URL(request.url).protocol === "https:",
      maxAge: 10 * 60,
      path: "/",
    });
    return response;
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Cidentia OAuth ist nicht konfiguriert." },
      { status: 500 },
    );
  }
}
