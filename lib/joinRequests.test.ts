import { describe, expect, it } from "vitest";
import {
  approvalRefusal,
  joinApprovedEmail,
  askRefusal,
  declineShows,
  DECLINE_COOLDOWN_DAYS,
  JOIN_CODE_ATTEMPTS_PER_HOUR,
  MAX_PENDING_REQUESTS,
  withinAttemptLimit,
} from "./joinRequests";

const NOW = new Date("2026-11-26T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("code attempts", () => {
  it("ten an hour per person; the count includes the attempt being made", () => {
    expect(JOIN_CODE_ATTEMPTS_PER_HOUR).toBe(10);
    expect(withinAttemptLimit(1)).toBe(true);
    expect(withinAttemptLimit(10)).toBe(true);
    expect(withinAttemptLimit(11)).toBe(false);
  });
});

describe("asking to join", () => {
  const fresh = { pendingHere: false, pendingCount: 0, declinedAt: null };

  it("allowed with nothing in the way", () => {
    expect(askRefusal(fresh, "Saturday Club", NOW)).toBeNull();
  });

  it("one request per club at a time", () => {
    expect(askRefusal({ ...fresh, pendingHere: true }, "Saturday Club", NOW)).toBe(
      "You've already asked to join Saturday Club.",
    );
  });

  it("at most five waiting at once", () => {
    expect(MAX_PENDING_REQUESTS).toBe(5);
    expect(askRefusal({ ...fresh, pendingCount: 4 }, "Saturday Club", NOW)).toBeNull();
    expect(askRefusal({ ...fresh, pendingCount: 5 }, "Saturday Club", NOW)).toBe(
      "You have 5 requests waiting. Cancel one to ask another club.",
    );
  });

  it("a decline blocks asking that club again for 30 days, then it's allowed", () => {
    expect(DECLINE_COOLDOWN_DAYS).toBe(30);
    expect(askRefusal({ ...fresh, declinedAt: daysAgo(29) }, "Saturday Club", NOW)).toBe(
      "Saturday Club didn't accept your request.",
    );
    expect(askRefusal({ ...fresh, declinedAt: daysAgo(30) }, "Saturday Club", NOW)).toBeNull();
  });

  it("the decline message shows for the same 30 days", () => {
    expect(declineShows(daysAgo(0), NOW)).toBe(true);
    expect(declineShows(daysAgo(29.9), NOW)).toBe(true);
    expect(declineShows(daysAgo(30), NOW)).toBe(false);
  });
});

describe("approving", () => {
  const ok = { alreadyMember: false, active: 3, pendingInvites: 1, clashIn: null };

  it("allowed with a seat free and no clash", () => {
    expect(approvalRefusal(ok, "Saturday Club", "Ana")).toBeNull();
  });

  it("someone already in: nothing to approve", () => {
    expect(approvalRefusal({ ...ok, alreadyMember: true }, "Saturday Club", "Ana")).toBe("Ana is already in Saturday Club.");
  });

  it("the seat cap counts pending invites too, so an invite's held seat is never taken", () => {
    expect(approvalRefusal({ ...ok, active: 5, pendingInvites: 0 }, "Saturday Club", "Ana")).toBeNull();
    expect(approvalRefusal({ ...ok, active: 5, pendingInvites: 1 }, "Saturday Club", "Ana")).toBe(
      "Saturday Club is full. Free a seat to let them in.",
    );
    expect(approvalRefusal({ ...ok, active: 6, pendingInvites: 0 }, "Saturday Club", "Ana")).toBe(
      "Saturday Club is full. Free a seat to let them in.",
    );
  });

  it("a display name already taken in the club (u2)", () => {
    expect(approvalRefusal({ ...ok, clashIn: "Saturday Club" }, "Saturday Club", "Ana")).toBe(
      "Someone in Saturday Club already goes by Ana.",
    );
  });
});

describe("the approval email", () => {
  it("says only that they're in, with one link; the club name escaped", () => {
    const m = joinApprovedEmail('<b>"Bad" & Co</b>', "https://dev.kinomato.com/clubs/abc");
    expect(m.subject).toBe('You\'re in <b>"Bad" & Co</b>');
    expect(m.html).toContain("&lt;b&gt;&quot;Bad&quot; &amp; Co&lt;/b&gt;");
    expect(m.html).not.toContain("<b>");
    expect(m.html.match(/<a /g)).toHaveLength(1);
    expect(m.html).toContain('href="https://dev.kinomato.com/clubs/abc"');
    expect(m.text).toBe('You\'re in <b>"Bad" & Co</b> on Kinomato.\n\nOpen it: https://dev.kinomato.com/clubs/abc\n');
  });
});
