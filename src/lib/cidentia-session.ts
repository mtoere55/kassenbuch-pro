export interface CidentiaSession {
  cid: string;
  connectedAt: string;
  verified: true;
  verifiedAt: string;
  expiresAt: string;
  method: "otp" | "quick-verify" | "oauth";
  user?: {
    id?: string;
    fullName?: string;
    email?: string;
    trustScore?: number;
    verificationLevel?: string;
  };
}

/**
 * Kept only so the new gateway can remove obsolete browser sessions created by
 * the former CID/localStorage login flow. Authentication now uses an HttpOnly
 * cookie managed by the server.
 */
export const CID_SESSION_KEY = "kassenbuch-pro.cid-session";
export const CIDENTIA_SESSION_COOKIE = "kassenbuch-pro.cid-session";

export function normalizeCid(value: string): string {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

export function isValidCid(value?: string): value is string {
  if (!value) return false;
  return /^[A-Z0-9._:-]{3,120}$/.test(value);
}

export function isVerifiedCidentiaSession(value: unknown): value is CidentiaSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CidentiaSession>;
  if (candidate.verified !== true || !isValidCid(candidate.cid) || !candidate.verifiedAt) return false;
  if (!candidate.expiresAt) return false;
  const expiresAt = Date.parse(candidate.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}
