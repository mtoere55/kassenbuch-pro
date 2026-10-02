import "server-only";

import type { NextRequest } from "next/server";
import {
  CIDENTIA_SESSION_COOKIE,
  readCidentiaSessionCookie,
} from "./cidentia-cookie-session";

export function requireCidFromRequest(request: NextRequest): string {
  const session = readCidentiaSessionCookie(
    request.cookies.get(CIDENTIA_SESSION_COOKIE)?.value,
  );
  if (!session) throw new Error("Keine aktive Cidentia Sitzung.");
  return session.cid;
}
