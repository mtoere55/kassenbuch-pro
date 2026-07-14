import { describe, expect, it } from "vitest";
import {
  createCidentiaSessionCookie,
  readCidentiaSessionCookie,
} from "./cidentia-cookie-session";
import {
  isValidEmail,
  isValidOtpCode,
  normalizeEmail,
  normalizeOtpCode,
} from "./cidentia-otp";
import {
  isVerifiedCidentiaSession,
  type CidentiaSession,
} from "./cidentia-session";

function validSession(): CidentiaSession {
  const now = new Date();
  return {
    cid: "CID-26-00004",
    connectedAt: now.toISOString(),
    verified: true,
    verifiedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    method: "otp",
    user: {
      fullName: "Murat Töre",
      email: "mtoere55@gmail.com",
    },
  };
}

describe("Cidentia OTP session", () => {
  it("normalizes and validates email and OTP input", () => {
    expect(normalizeEmail("  MTOERE55@GMAIL.COM ")).toBe("mtoere55@gmail.com");
    expect(isValidEmail("mtoere55@gmail.com")).toBe(true);
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(normalizeOtpCode(" 624 024 ")).toBe("624024");
    expect(isValidOtpCode("624024")).toBe(true);
    expect(isValidOtpCode("12ab")).toBe(false);
  });

  it("accepts only unexpired verified sessions", () => {
    expect(isVerifiedCidentiaSession(validSession())).toBe(true);
    expect(isVerifiedCidentiaSession({ ...validSession(), expiresAt: "2020-01-01T00:00:00.000Z" })).toBe(false);
  });

  it("signs the HttpOnly session payload and rejects tampering", () => {
    const session = validSession();
    const cookie = createCidentiaSessionCookie(session);
    expect(readCidentiaSessionCookie(cookie)).toEqual(session);
    expect(readCidentiaSessionCookie(`${cookie}x`)).toBeUndefined();
  });
});
