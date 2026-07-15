import { beforeEach, describe, expect, it } from "vitest";
import {
  assertOtpRateLimit,
  clientAddress,
  consumeRateLimit,
  OtpRateLimitError,
  resetOtpRateLimitsForTests,
} from "./otp-rate-limit";

beforeEach(() => {
  resetOtpRateLimitsForTests();
});

describe("OTP rate limiting", () => {
  it("blocks attempts after the fixed-window limit and exposes retry time", () => {
    consumeRateLimit("test", 2, 60_000, 1_000);
    consumeRateLimit("test", 2, 60_000, 2_000);

    expect(() => consumeRateLimit("test", 2, 60_000, 3_000)).toThrow(OtpRateLimitError);

    try {
      consumeRateLimit("test", 2, 60_000, 3_000);
    } catch (cause) {
      expect(cause).toBeInstanceOf(OtpRateLimitError);
      expect((cause as OtpRateLimitError).retryAfterSeconds).toBe(58);
    }
  });

  it("starts a new window after expiry", () => {
    consumeRateLimit("test", 1, 1_000, 1_000);
    expect(() => consumeRateLimit("test", 1, 1_000, 1_500)).toThrow(OtpRateLimitError);
    expect(() => consumeRateLimit("test", 1, 1_000, 2_001)).not.toThrow();
  });

  it("prefers Cloudflare client addresses and limits repeated OTP sends", () => {
    const request = {
      headers: new Headers({
        "cf-connecting-ip": "203.0.113.10",
        "x-forwarded-for": "198.51.100.5, 198.51.100.6",
      }),
    };

    expect(clientAddress(request)).toBe("203.0.113.10");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assertOtpRateLimit(request, "send", "murat@example.com");
    }
    expect(() => assertOtpRateLimit(request, "send", "murat@example.com")).toThrow(OtpRateLimitError);
  });
});
