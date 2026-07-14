import type { CidentiaSession } from "./cidentia-session";
import {
  CIDENTIA_SESSION_TTL_SECONDS,
  isValidCid,
  normalizeCid,
} from "./cidentia-session";

const DEFAULT_CIDENTIA_OTP_BASE = "https://api.cidendb.com/api/v1/auth/otp";

export function cidentiaOtpBase(): string {
  return (process.env.CIDENTIA_OTP_BASE || DEFAULT_CIDENTIA_OTP_BASE).replace(/\/+$/, "");
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  if (!value || value.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function normalizeOtpCode(value: string): string {
  return value.replace(/\s+/g, "").trim();
}

export function isValidOtpCode(value: string): boolean {
  return /^\d{4,10}$/.test(value);
}

export async function sendCidentiaOtp(emailValue: string): Promise<string> {
  const email = normalizeEmail(emailValue);
  if (!isValidEmail(email)) throw new Error("Bitte eine gültige E-Mail-Adresse eingeben.");

  const response = await fetch(`${cidentiaOtpBase()}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contact: email, contact_type: "email" }),
    cache: "no-store",
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(errorMessage(payload, "Cidentia konnte keinen Bestätigungscode senden."));
  }

  return textValue(payload, ["message"]) || `Bestätigungscode wurde an ${email} gesendet.`;
}

export async function verifyCidentiaOtp(emailValue: string, codeValue: string): Promise<CidentiaSession> {
  const email = normalizeEmail(emailValue);
  const code = normalizeOtpCode(codeValue);
  if (!isValidEmail(email)) throw new Error("Bitte eine gültige E-Mail-Adresse eingeben.");
  if (!isValidOtpCode(code)) throw new Error("Bitte den gültigen Bestätigungscode eingeben.");

  const response = await fetch(`${cidentiaOtpBase()}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contact: email, contact_type: "email", code }),
    cache: "no-store",
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(errorMessage(payload, "Der Cidentia Bestätigungscode ist ungültig oder abgelaufen."));
  }

  const user = objectValue(payload, ["user", "profile", "identity"]);
  if (!user) throw new Error("Cidentia hat keine Benutzeridentität zurückgegeben.");

  const cidValue = textValue(user, ["cid_number", "cid", "ciden_id", "cidenId"]);
  if (!cidValue) throw new Error("Cidentia hat keine CID zurückgegeben.");
  const cid = normalizeCid(cidValue);
  if (!isValidCid(cid)) throw new Error("Cidentia hat eine ungültige CID zurückgegeben.");

  const now = new Date();
  const expiresAt = new Date(now.getTime() + CIDENTIA_SESSION_TTL_SECONDS * 1000);
  return {
    cid,
    connectedAt: now.toISOString(),
    verified: true,
    verifiedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    method: "otp",
    user: {
      id: textValue(user, ["id", "user_id", "userId"]),
      fullName: textValue(user, ["full_name", "fullName", "name"]),
      email: textValue(user, ["email", "email_address", "contact"]) || email,
      trustScore: numberValue(user, ["trust_score", "trustScore"]),
      verificationLevel: textValue(user, ["verification_level", "verificationLevel", "level"]),
    },
  };
}

async function readJson(response: Response): Promise<Record<string, unknown> | undefined> {
  const text = await response.text();
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { message: text };
  }
}

function textValue(payload: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!payload) return undefined;
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function numberValue(payload: Record<string, unknown> | undefined, keys: string[]): number | undefined {
  if (!payload) return undefined;
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}

function objectValue(payload: Record<string, unknown> | undefined, keys: string[]): Record<string, unknown> | undefined {
  if (!payload) return undefined;
  for (const key of keys) {
    const value = payload[key];
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  }
  return undefined;
}

function errorMessage(payload: Record<string, unknown> | undefined, fallback: string): string {
  return textValue(payload, ["message", "error", "detail"]) || fallback;
}
