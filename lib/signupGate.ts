// Invite-only sign-up (docs/onboarding-spec.md §11.1, ruled 2026-11-18): no
// public sign-ups until a lawyer has signed off the Terms and Privacy text,
// so a new account is created only through a valid personal invite.
// Existing accounts sign in as normal. Pure: app/signIn.ts reads the
// setting and the rows, and applies these.

export const INVITE_ONLY_MESSAGE = "Kinomato is invite-only for now. Ask a member of a club to invite you.";

// OPEN_SIGNUP, a server setting. Exactly "true" opens sign-up; unset or
// anything else keeps it closed, so a typo fails safe.
export function isSignupOpen(value: string | undefined): boolean {
  return value === "true";
}

// What /login sends an address: a code, or the invite-only email. The
// screen after it is the same either way (no account enumeration, §4.3).
export function signInEmailKind(input: {
  accountExists: boolean;
  fromInvite: boolean;
  signupOpen: boolean;
}): "code" | "invite-only" {
  return input.accountExists || input.fromInvite || input.signupOpen ? "code" : "invite-only";
}

// Whether completing a sign-in may create the account it found missing.
// Closed: only through the invite the sign-in came from, still unredeemed
// and unrevoked.
export function mayCreateAccount(input: {
  signupOpen: boolean;
  invite: { redeemedAt: Date | null; revokedAt: Date | null } | null;
}): boolean {
  if (input.signupOpen) return true;
  return input.invite !== null && input.invite.redeemedAt === null && input.invite.revokedAt === null;
}
