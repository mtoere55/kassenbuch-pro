import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";

export type OtpRateLimitScope = "send" | "verify";

interface RateLimitBucket {
  count: number;
  resetAt: number;
  touchedAt: number;
}

const WINDOW_MS = 15 * 60 * 1000;
const MAX_BUCKETS = 10_000;
const buckets = new Map<string, RateLimitBucket>();

const RULES: Record<OtpRateLimitScope, { identityLimit: number; ipLimit: number }> = {
  send: { identityLimit: 5, ipLimit: 20 },
  verify: { identityLimit: 10, ipLimit: 50 },
};

export class OtpRateLimitError extends Error {
  readonly status = 429;
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("Zu viele Anmeldeversuche. Bitte später erneut versuchen.");
    this.name = "OtpRateLimitError";
    this.retryAfterSeconds = Math.max(1, retryAfterSeconds);
  }
}

export function clientAddress(request: Pick<NextRequest, "headers">): string {
  const cloudflareAddress = request.headers.get("cf-connecting-ip")?.trim();
  if (cloudflareAddress) return cloudflareAddress;

  const forwardedAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwardedAddress) return forwardedAddress;

  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function consumeRateLimit(
  key: string,
  limit: number,
  windowMs = WINDOW_MS,
  now = Date.now(),
): void {
  cleanupExpiredBuckets(now);
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs, touchedAt: now });
    return;
  }

  if (current.count >= limit) {
    throw new OtpRateLimitError(Math.ceil((current.resetAt - now) / 1000));
  }

  current.count += 1;
  current.touchedAt = now;
}

export function assertOtpRateLimit(
  request: Pick<NextRequest, "headers">,
  scope: OtpRateLimitScope,
  emailValue: string,
): void {
  const address = clientAddress(request);
  const identityHash = createHash("sha256")
    .update(emailValue.trim().toLowerCase().slice(0, 254) || "<empty>")
    .digest("hex")
    .slice(0, 24);
  const rules = RULES[scope];

  consumeRateLimit(`otp:${scope}:identity:${address}:${identityHash}`, rules.identityLimit);
  consumeRateLimit(`otp:${scope}:ip:${address}`, rules.ipLimit);
}

function cleanupExpiredBuckets(now: number): void {
  if (buckets.size < MAX_BUCKETS) return;

  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }

  if (buckets.size < MAX_BUCKETS) return;

  const removeCount = Math.max(1, Math.ceil(MAX_BUCKETS * 0.1));
  const oldest = [...buckets.entries()]
    .sort((left, right) => left[1].touchedAt - right[1].touchedAt)
    .slice(0, removeCount);
  for (const [key] of oldest) buckets.delete(key);
}

export function resetOtpRateLimitsForTests(): void {
  buckets.clear();
}
