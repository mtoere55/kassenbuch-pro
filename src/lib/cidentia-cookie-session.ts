import { createHmac, timingSafeEqual } from "node:crypto";
import {
  CIDENTIA_SESSION_COOKIE,
  CIDENTIA_SESSION_TTL_SECONDS,
  isVerifiedCidentiaSession,
  type CidentiaSession,
} from "./cidentia-session";

function requireSessionSecret(): string {
  const secret = process.env.CIDENTIA_SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV !== "production") {
    return "kassenbuch-pro-development-session-secret-change-me";
  }
  throw new Error("CIDENTIA_SESSION_SECRET ist auf dem Server nicht gesetzt oder zu kurz.");
}

function signature(payload: string): string {
  return createHmac("sha256", requireSessionSecret()).update(payload).digest("base64url");
}

export function createCidentiaSessionCookie(session: CidentiaSession): string {
  if (!isVerifiedCidentiaSession(session)) throw new Error("Ungültige Cidentia Sitzung.");
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function readCidentiaSessionCookie(value?: string): CidentiaSession | undefined {
  if (!value) return undefined;
  const [payload, providedSignature, extra] = value.split(".");
  if (!payload || !providedSignature || extra) return undefined;

  const expectedSignature = signature(payload);
  const provided = Buffer.from(providedSignature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return undefined;

  try {
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    const session = JSON.parse(decoded) as unknown;
    return isVerifiedCidentiaSession(session) ? session : undefined;
  } catch {
    return undefined;
  }
}

export function cidentiaSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: CIDENTIA_SESSION_TTL_SECONDS,
  };
}

export function expiredCidentiaSessionCookieOptions() {
  return {
    ...cidentiaSessionCookieOptions(),
    maxAge: 0,
  };
}

export { CIDENTIA_SESSION_COOKIE };
