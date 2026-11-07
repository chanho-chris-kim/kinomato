import { describe, expect, it } from "vitest";
import { CHANGE_REQUESTS_PER_DAY, checkChangeRequestAllowed, evaluateEmailChange } from "./emailChange";

const NOW = new Date("2026-11-06T12:00:00Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

const row = (overrides: Partial<Parameters<typeof evaluateEmailChange>[0]> = {}) => ({
  attempts: 0,
  expiresAt: minutes(10),
  consumedAt: null,
  cancelledAt: null,
  ...overrides,
});

describe("evaluateEmailChange", () => {
  it("usable while unexpired, unconsumed, uncancelled and under 5 wrong codes", () => {
    expect(evaluateEmailChange(row(), NOW)).toBe("usable");
    expect(evaluateEmailChange(row({ attempts: 4 }), NOW)).toBe("usable");
  });
  it("locked after 5 wrong codes", () => {
    expect(evaluateEmailChange(row({ attempts: 5 }), NOW)).toBe("locked");
  });
  it("expired at its 15-minute mark", () => {
    expect(evaluateEmailChange(row({ expiresAt: NOW }), NOW)).toBe("expired");
    expect(evaluateEmailChange(row({ expiresAt: minutes(-1) }), NOW)).toBe("expired");
  });
  it("consumed and cancelled win over everything else", () => {
    expect(evaluateEmailChange(row({ consumedAt: minutes(-1), attempts: 5 }), NOW)).toBe("consumed");
    expect(evaluateEmailChange(row({ cancelledAt: minutes(-1), expiresAt: minutes(-5) }), NOW)).toBe("cancelled");
  });
});

describe("checkChangeRequestAllowed (3 per user per rolling 24h)", () => {
  it("allows up to three in 24 hours", () => {
    expect(CHANGE_REQUESTS_PER_DAY).toBe(3);
    expect(checkChangeRequestAllowed([], NOW)).toBe(true);
    expect(checkChangeRequestAllowed([minutes(-60), minutes(-30)], NOW)).toBe(true);
  });
  it("refuses a fourth inside the window", () => {
    expect(checkChangeRequestAllowed([minutes(-600), minutes(-60), minutes(-1)], NOW)).toBe(false);
  });
  it("is rolling: a request just over 24 hours old no longer counts", () => {
    const old = new Date(NOW.getTime() - 24 * 3600_000 - 1);
    expect(checkChangeRequestAllowed([old, minutes(-60), minutes(-1)], NOW)).toBe(true);
    const edge = new Date(NOW.getTime() - 24 * 3600_000 + 1);
    expect(checkChangeRequestAllowed([edge, minutes(-60), minutes(-1)], NOW)).toBe(false);
  });
});
