import { describe, expect, it } from "vitest";
import { hashToken } from "./authCredentials";
import {
  generateUnsubscribeToken,
  isUnsubscribeTokenShaped,
  isUnsubscribeTokenUsable,
  mayGetRemindersFrom,
  UNSUBSCRIBE_TOKEN_DAYS,
} from "./reminderPrefs";

// Reminder preferences and unsubscribe links (docs/onboarding-spec.md
// §5.9, ruled 2026-11-23). Reminders default on; sign-in codes, account
// notices and ops alerts never look at these settings.

describe("generateUnsubscribeToken", () => {
  it("is 256 random bits, base64url: opaque, unguessable, and URL-safe", () => {
    const token = generateUnsubscribeToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isUnsubscribeTokenShaped(token)).toBe(true);
    const many = new Set(Array.from({ length: 200 }, () => generateUnsubscribeToken()));
    expect(many.size).toBe(200);
  });

  it("is stored only as its SHA-256 hash (lib/authCredentials.ts hashToken)", () => {
    const token = generateUnsubscribeToken();
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).not.toContain(token);
  });

  it("anything else isn't a token: never even hashed and looked up", () => {
    for (const bad of ["", "done", "abc", "x".repeat(42), `${"x".repeat(42)}!`, "a@example.com", "../settings"]) {
      expect(isUnsubscribeTokenShaped(bad), bad).toBe(false);
    }
  });
});

describe("isUnsubscribeTokenUsable (90 days)", () => {
  const createdAt = new Date("2026-11-23T10:00:00Z");
  const days = (n: number) => new Date(createdAt.getTime() + n * 24 * 3600_000);

  it(`works for ${UNSUBSCRIBE_TOKEN_DAYS} days, then stops`, () => {
    expect(UNSUBSCRIBE_TOKEN_DAYS).toBe(90);
    expect(isUnsubscribeTokenUsable({ createdAt }, createdAt)).toBe(true);
    expect(isUnsubscribeTokenUsable({ createdAt }, days(89))).toBe(true);
    expect(isUnsubscribeTokenUsable({ createdAt }, new Date(days(90).getTime() - 1))).toBe(true);
    expect(isUnsubscribeTokenUsable({ createdAt }, days(90))).toBe(false);
    expect(isUnsubscribeTokenUsable({ createdAt }, days(400))).toBe(false);
  });
});

describe("mayGetRemindersFrom (who a club's reminders could go to)", () => {
  const active = { leftAt: null, remindersMutedAt: null };

  it("reminders on, and this membership active and not muted", () => {
    expect(mayGetRemindersFrom({ emailReminders: true, membership: active })).toBe(true);
  });

  it("not with reminder emails off, whatever the club", () => {
    expect(mayGetRemindersFrom({ emailReminders: false, membership: active })).toBe(false);
  });

  it("not from a club muted, or one they've left", () => {
    const at = new Date("2026-11-20T00:00:00Z");
    expect(mayGetRemindersFrom({ emailReminders: true, membership: { leftAt: null, remindersMutedAt: at } })).toBe(false);
    expect(mayGetRemindersFrom({ emailReminders: true, membership: { leftAt: at, remindersMutedAt: null } })).toBe(false);
  });
});
