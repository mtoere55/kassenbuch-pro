export interface CidentiaSession {
  cid: string;
  connectedAt: string;
  verified: true;
  verifiedAt: string;
  method: "quick-verify" | "oauth";
  user?: {
    fullName?: string;
    email?: string;
    trustScore?: number;
    verificationLevel?: string;
  };
}

export const CID_SESSION_KEY = "kassenbuch-pro.cid-session";

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
  return candidate.verified === true && isValidCid(candidate.cid) && Boolean(candidate.verifiedAt);
}
