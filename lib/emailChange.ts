// Email change (docs/onboarding-spec.md §5.9 rulings; rebuild step 7b).
// Pure. A code sent to the new address, entered on /settings in the
// signed-in session; held in email_changes, which sign-in never reads.

import { CODE_MAX_ATTEMPTS } from "./authCredentials";

export const EMAIL_CHANGE_DURATION_MS = 15 * 60 * 1000;
export const CHANGE_REQUESTS_PER_DAY = 3;

export type EmailChangeState = "usable" | "expired" | "locked" | "consumed" | "cancelled";

// Consumed and cancelled are final; then expiry; then the 5-wrong-codes
// lock, the same limit as sign-in codes (§4.3).
export function evaluateEmailChange(
  change: { attempts: number; expiresAt: Date; consumedAt: Date | null; cancelledAt: Date | null },
  now: Date,
): EmailChangeState {
  if (change.consumedAt !== null) return "consumed";
  if (change.cancelledAt !== null) return "cancelled";
  if (change.expiresAt.getTime() <= now.getTime()) return "expired";
  if (change.attempts >= CODE_MAX_ATTEMPTS) return "locked";
  return "usable";
}

// At most 3 change requests per person in any rolling 24 hours, on top of
// the per-address send limits shared with sign-in (§4.3).
export function checkChangeRequestAllowed(recentRequests: Date[], now: Date): boolean {
  const dayAgo = now.getTime() - 24 * 3600_000;
  return recentRequests.filter((d) => d.getTime() > dayAgo).length < CHANGE_REQUESTS_PER_DAY;
}
