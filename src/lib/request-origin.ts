import type { NextRequest } from "next/server";

export function assertSameOrigin(request: NextRequest): void {
  const origin = request.headers.get("origin");
  if (!origin) return;

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const requestHost = forwardedHost || request.headers.get("host") || request.nextUrl.host;
  let originHost = "";
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new Error("Ungültiger Anfrage-Ursprung.");
  }

  if (!requestHost || originHost !== requestHost) {
    throw new Error("Diese Anfrage ist nur von Kassenbuch Pro erlaubt.");
  }
}
