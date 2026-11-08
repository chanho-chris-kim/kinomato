import { describe, expect, it } from "vitest";
import { isPastRetention, retentionCutoffs, RETENTION } from "./retention";

const NOW = new Date("2026-11-08T10:00:00Z");
const ago = (days: number, hours = 0) => new Date(NOW.getTime() - (days * 24 + hours) * 3600_000);

describe("retentionCutoffs", () => {
  it("is 7 days for expired credentials and sessions, 90 days for revoked invites' names", () => {
    expect(RETENTION).toEqual({ expiredDays: 7, revokedInviteNameDays: 90 });
    expect(retentionCutoffs(NOW)).toEqual({ expiredBefore: ago(7), revokedBefore: ago(90) });
  });
});

describe("isPastRetention", () => {
  const { expiredBefore, revokedBefore } = retentionCutoffs(NOW);

  it("deletes a row that expired more than 7 days ago, keeps one that didn't", () => {
    expect(isPastRetention(ago(7, 1), expiredBefore)).toBe(true);
    expect(isPastRetention(ago(6, 23), expiredBefore)).toBe(false);
    expect(isPastRetention(ago(30), expiredBefore)).toBe(true);
    // Not expired yet at all.
    expect(isPastRetention(new Date(NOW.getTime() + 60_000), expiredBefore)).toBe(false);
  });

  it("is strictly before the cutoff: exactly 7 days ago is kept", () => {
    expect(isPastRetention(ago(7), expiredBefore)).toBe(false);
  });

  it("clears a revoked invite's name after 90 days, not before", () => {
    expect(isPastRetention(ago(91), revokedBefore)).toBe(true);
    expect(isPastRetention(ago(89), revokedBefore)).toBe(false);
    expect(isPastRetention(ago(90), revokedBefore)).toBe(false);
  });

  it("never touches a row with no date (a pending or redeemed invite)", () => {
    expect(isPastRetention(null, revokedBefore)).toBe(false);
  });
});
