import type { CidentiaSession } from "./cidentia-session";
import { isValidCid, normalizeCid } from "./cidentia-session";

const DEFAULT_CIDENTIA_API_BASE = "https://api.cidendb.com/api/v1/sdk";

export function cidentiaApiBase(): string {
  return (process.env.CIDENTIA_API_BASE || DEFAULT_CIDENTIA_API_BASE).replace(/\/+$/, "");
}

export function cidentiaRedirectUri(requestUrl: string): string {
  return process.env.CIDENTIA_REDIRECT_URI || `${new URL(requestUrl).origin}/cid/callback`;
}

export function requireCidentiaClientId(): string {
  const value = process.env.CIDENTIA_CLIENT_ID;
  if (!value) throw new Error("CIDENTIA_CLIENT_ID ist auf dem Server nicht gesetzt.");
  return value;
}

export function requireCidentiaClientSecret(): string {
  const value = process.env.CIDENTIA_CLIENT_SECRET;
  if (!value) throw new Error("CIDENTIA_CLIENT_SECRET ist auf dem Server nicht gesetzt.");
  return value;
}

export function requireCidentiaApiKey(): string {
  const value = process.env.CIDENTIA_API_KEY;
  if (!value) throw new Error("CIDENTIA_API_KEY ist auf dem Server nicht gesetzt.");
  return value;
}

export function cidentiaAuthHeaders(apiKey: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "x-api-key": apiKey,
    "X-CidenDB-API-Key": apiKey,
  };
}

export async function verifyCidWithCidentia(cidValue: string): Promise<CidentiaSession> {
  const cid = normalizeCid(cidValue);
  if (!isValidCid(cid)) throw new Error("Ungültige CID.");

  const apiKey = requireCidentiaApiKey();
  const response = await fetch(`${cidentiaApiBase()}/verify`, {
    method: "POST",
    headers: cidentiaAuthHeaders(apiKey),
    body: JSON.stringify({ cid }),
    cache: "no-store",
  });
  const payload = await readJson(response);
  if (!response.ok || payload?.valid === false || payload?.verified === false || payload?.success === false) {
    throw new Error(errorMessage(payload, "CidenDB hat diese CID nicht bestätigt."));
  }

  return buildSessionFromPayload(cid, payload, "quick-verify");
}

export async function exchangeCidentiaCode({
  code,
  requestUrl,
}: {
  code: string;
  requestUrl: string;
}): Promise<CidentiaSession> {
  if (!code.trim()) throw new Error("Kein Cidentia Code erhalten.");
  const clientId = requireCidentiaClientId();
  const clientSecret = requireCidentiaClientSecret();
  const redirectUri = cidentiaRedirectUri(requestUrl);

  const response = await fetch(`${cidentiaApiBase()}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
    cache: "no-store",
  });
  const payload = await readJson(response);
  if (!response.ok) throw new Error(errorMessage(payload, "Cidentia Token konnte nicht geholt werden."));

  const accessToken = textValue(payload, ["access_token", "accessToken"]);
  const embeddedUser = objectValue(payload, ["user", "profile", "identity"]);
  const user = embeddedUser || (accessToken ? await fetchCidentiaMe(accessToken) : undefined);
  const cid = extractCid(user) || extractCid(payload);
  if (!cid) throw new Error("Cidentia Antwort enthält keine CID.");
  return buildSessionFromPayload(cid, user || payload, "oauth");
}

async function fetchCidentiaMe(accessToken: string): Promise<Record<string, unknown> | undefined> {
  const response = await fetch(`${cidentiaApiBase()}/me`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) return undefined;
  return readJson(response);
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

function buildSessionFromPayload(cidValue: string, payload: Record<string, unknown> | undefined, method: CidentiaSession["method"]): CidentiaSession {
  const cid = normalizeCid(cidValue);
  if (!isValidCid(cid)) throw new Error("Cidentia Antwort enthält keine gültige CID.");
  const now = new Date().toISOString();
  return {
    cid,
    connectedAt: now,
    verified: true,
    verifiedAt: now,
    method,
    user: {
      fullName: textValue(payload, ["full_name", "fullName", "name"]),
      email: textValue(payload, ["email", "email_address"]),
      trustScore: numberValue(payload, ["trust_score", "trustScore"]),
      verificationLevel: textValue(payload, ["verification_level", "verificationLevel", "level"]),
    },
  };
}

function extractCid(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  return textValue(record, ["cid", "ciden_id", "cidenId", "identity", "sub", "id"]);
}

function textValue(payload: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!payload) return undefined;
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function numberValue(payload: Record<string, unknown> | undefined, keys: string[]): number | undefined {
  if (!payload) return undefined;
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) return Number(value);
  }
  return undefined;
}

function objectValue(payload: Record<string, unknown> | undefined, keys: string[]): Record<string, unknown> | undefined {
  if (!payload) return undefined;
  for (const key of keys) {
    const value = payload[key];
    if (value && typeof value === "object") return value as Record<string, unknown>;
  }
  return undefined;
}

function errorMessage(payload: Record<string, unknown> | undefined, fallback: string): string {
  return textValue(payload, ["message", "error", "detail"]) || fallback;
}
