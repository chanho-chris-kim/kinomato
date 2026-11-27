// Asking to join with a club code (u5, ruled 2026-11-25; details
// 2026-11-26), as pure rules. The data lives in app/joinRequests.ts.

import { canCreateInvite } from "./invites";
import { escapeHtml } from "./reminders";

export const JOIN_CODE_ATTEMPTS_PER_HOUR = 10;
export const MAX_PENDING_REQUESTS = 5;
export const DECLINE_COOLDOWN_DAYS = 30;

const DAY_MS = 86_400_000;

// `attempts` counts this one too: it's recorded before the code is looked
// up, so simultaneous guesses can't share a try.
export function withinAttemptLimit(attempts: number): boolean {
  return attempts <= JOIN_CODE_ATTEMPTS_PER_HOUR;
}

// "{club} didn't accept your request." shows, and asking again is refused,
// for 30 days after a decline.
export function declineShows(declinedAt: Date, now: Date): boolean {
  return now.getTime() - declinedAt.getTime() < DECLINE_COOLDOWN_DAYS * DAY_MS;
}

// Why someone (not already a member) can't ask this club now, or null.
export function askRefusal(
  state: { pendingHere: boolean; pendingCount: number; declinedAt: Date | null },
  clubName: string,
  now: Date,
): string | null {
  if (state.pendingHere) return `You've already asked to join ${clubName}.`;
  if (state.declinedAt && declineShows(state.declinedAt, now)) return `${clubName} didn't accept your request.`;
  if (state.pendingCount >= MAX_PENDING_REQUESTS) {
    return `You have ${MAX_PENDING_REQUESTS} requests waiting. Cancel one to ask another club.`;
  }
  return null;
}

// Why an owner or admin can't approve now, or null; the request stays
// pending either way. The cap counts pending invites as well as active
// members (lib/invites.ts canCreateInvite), so an approval never takes a
// seat an invite is holding. `clashIn`: the club where the requester's
// display name is already taken (app/displayNameClash.ts), or null.
export function approvalRefusal(
  state: { alreadyMember: boolean; active: number; pendingInvites: number; clashIn: string | null },
  clubName: string,
  requesterName: string,
): string | null {
  if (state.alreadyMember) return `${requesterName} is already in ${clubName}.`;
  if (!canCreateInvite(state.active, state.pendingInvites)) return `${clubName} is full. Free a seat to let them in.`;
  if (state.clashIn) return `Someone in ${clubName} already goes by ${requesterName}.`;
  return null;
}

// "You're in {club}" (u5): to the requester once approved. Transactional,
// so it never counts as a reminder. One link and nothing else about the
// club or who approved.
export function joinApprovedEmail(clubName: string, clubUrl: string): { subject: string; html: string; text: string } {
  return {
    subject: `You're in ${clubName}`,
    html:
      `<p>You're in <strong>${escapeHtml(clubName)}</strong> on Kinomato.</p>` +
      `<p><a href="${escapeHtml(clubUrl)}">Open ${escapeHtml(clubName)}</a></p>`,
    text: `You're in ${clubName} on Kinomato.\n\nOpen it: ${clubUrl}\n`,
  };
}
