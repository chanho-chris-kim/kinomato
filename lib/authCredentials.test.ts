import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CODE_MAX_ATTEMPTS,
  checkSendAllowed,
  codeMatches,
  evaluateSignIn,
  generateSignInCode,
  getAuthSecret,
  hashCode,
  hashToken,
} from "./authCredentials";

describe("generateSignInCode", () => {
  it("is always exactly six digits, leading zeros kept", () => {
    for (let i = 0; i < 500; i++) {
      expect(generateSignInCode()).toMatch(/^\d{6}$/);
    }
  });

  it("maps random input onto the full 000000–999999 range", () => {
    // Deterministic byte sources, to prove the mapping rather than sample it.
    expect(generateSignInCode(() => 0)).toBe("000000");
    expect(generateSignInCode(() => 999_999)).toBe("999999");
    expect(generateSignInCode(() => 42)).toBe("000042");
  });

  it("rejects values that would bias the result instead of taking them modulo", () => {
    // 2^32 isn't a multiple of 1e6. Values at or above the largest multiple
    // must be redrawn, never folded down, or low codes come up more often.
    const limit = Math.floor(2 ** 32 / 1_000_000) * 1_000_000;
    const draws = [limit, limit + 5, 123];
    let i = 0;
    expect(generateSignInCode(() => draws[i++])).toBe("000123");
    expect(i).toBe(3);
  });
});

describe("hashToken", () => {
  it("is deterministic and never returns the token itself", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
    expect(hashToken("abc")).not.toContain("abc");
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("hashCode", () => {
  it("is keyed: the same code under a different secret hashes differently", () => {
    // A bare hash of a 6-digit code is crackable in milliseconds by anyone
    // who can read the table. The secret isn't in the table.
    expect(hashCode("123456", "secret-a")).toBe(hashCode("123456", "secret-a"));
    expect(hashCode("123456", "secret-a")).not.toBe(hashCode("123456", "secret-b"));
    expect(hashCode("123456", "secret-a")).not.toBe(hashToken("123456"));
  });
});

describe("codeMatches", () => {
  const stored = hashCode("123456", "s");

  it("accepts the right code", () => {
    expect(codeMatches("123456", stored, "s")).toBe(true);
  });

  it("rejects a wrong code, a wrong secret, and a missing hash", () => {
    expect(codeMatches("123457", stored, "s")).toBe(false);
    expect(codeMatches("123456", stored, "other")).toBe(false);
    expect(codeMatches("123456", null, "s")).toBe(false);
  });

  it("tolerates what people actually type: spaces, and nothing but digits counts", () => {
    expect(codeMatches(" 123 456 ", stored, "s")).toBe(true);
    expect(codeMatches("12345", stored, "s")).toBe(false);
    expect(codeMatches("12345a", stored, "s")).toBe(false);
  });
});

describe("evaluateSignIn", () => {
  const now = new Date("2026-09-27T12:00:00Z");
  const link = {
    expiresAt: new Date("2026-09-27T12:10:00Z"),
    consumedAt: null,
    attempts: 0,
  };

  it("is usable when unexpired, unconsumed and under the attempt limit", () => {
    expect(evaluateSignIn(link, now)).toBe("usable");
  });

  it("is consumed once used, by either the code or the link", () => {
    expect(evaluateSignIn({ ...link, consumedAt: now }, now)).toBe("consumed");
  });

  it("is expired at or past its expiry", () => {
    expect(evaluateSignIn({ ...link, expiresAt: now }, now)).toBe("expired");
  });

  it(`is locked after ${CODE_MAX_ATTEMPTS} wrong attempts, and not before`, () => {
    expect(evaluateSignIn({ ...link, attempts: CODE_MAX_ATTEMPTS - 1 }, now)).toBe("usable");
    expect(evaluateSignIn({ ...link, attempts: CODE_MAX_ATTEMPTS }, now)).toBe("locked");
  });

  it("reports consumed ahead of expired or locked — it worked, it's just spent", () => {
    expect(
      evaluateSignIn({ expiresAt: now, consumedAt: now, attempts: CODE_MAX_ATTEMPTS }, now),
    ).toBe("consumed");
  });
});

describe("checkSendAllowed", () => {
  const now = new Date("2026-09-27T12:00:00Z");
  const ago = (s: number) => new Date(now.getTime() - s * 1000);

  it("allows a first send", () => {
    expect(checkSendAllowed([], now)).toEqual({ ok: true });
  });

  it("enforces a 30-second cooldown after the latest send", () => {
    expect(checkSendAllowed([ago(10)], now)).toEqual({ ok: false, retryAfterSeconds: 20 });
    expect(checkSendAllowed([ago(30)], now)).toEqual({ ok: true });
  });

  it("allows at most 5 sends in any rolling hour", () => {
    const five = [ago(60), ago(600), ago(1200), ago(1800), ago(3000)];
    const result = checkSendAllowed(five, now);
    expect(result.ok).toBe(false);
    // Frees up when the oldest of the five leaves the hour: 3600 - 3000.
    expect(result).toEqual({ ok: false, retryAfterSeconds: 600 });
  });

  it("ignores sends older than an hour", () => {
    const old = [ago(3601), ago(4000), ago(5000), ago(6000), ago(7000), ago(8000)];
    expect(checkSendAllowed(old, now)).toEqual({ ok: true });
  });
});

describe("getAuthSecret", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses AUTH_SECRET when it's set", () => {
    vi.stubEnv("AUTH_SECRET", "from-env");
    vi.stubEnv("NODE_ENV", "production");
    expect(getAuthSecret()).toBe("from-env");
  });

  it("falls back to a fixed dev value outside production, so local dev needs no setup", () => {
    vi.stubEnv("AUTH_SECRET", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(getAuthSecret()).toBe(getAuthSecret());
    expect(getAuthSecret().length).toBeGreaterThan(0);
  });

  it("fails loud in production when unset — never signs codes with a guessable key", () => {
    vi.stubEnv("AUTH_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => getAuthSecret()).toThrow(/AUTH_SECRET/);
  });
});
