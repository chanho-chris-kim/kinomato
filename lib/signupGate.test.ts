import { describe, expect, it } from "vitest";
import { isSignupOpen, mayCreateAccount, signInEmailKind } from "./signupGate";

// Invite-only sign-up (docs/onboarding-spec.md §11.1, ruled 2026-11-18): no
// public sign-ups until a lawyer has signed off the Terms and Privacy, so a
// new account comes only through a valid personal invite.

describe("isSignupOpen (OPEN_SIGNUP fails safe to closed)", () => {
  it('is open only for exactly "true"', () => {
    expect(isSignupOpen("true")).toBe(true);
  });

  it("is closed when unset, empty or anything else", () => {
    for (const value of [undefined, "", "false", "TRUE", "True", " true", "true ", "1", "yes", "on"]) {
      expect(isSignupOpen(value), String(value)).toBe(false);
    }
  });
});

describe("signInEmailKind (what /login sends)", () => {
  it("an existing account gets a code, open or closed", () => {
    expect(signInEmailKind({ accountExists: true, fromInvite: false, signupOpen: false })).toBe("code");
    expect(signInEmailKind({ accountExists: true, fromInvite: false, signupOpen: true })).toBe("code");
  });

  it("someone arriving from an invite gets a code, with or without an account", () => {
    expect(signInEmailKind({ accountExists: false, fromInvite: true, signupOpen: false })).toBe("code");
    expect(signInEmailKind({ accountExists: true, fromInvite: true, signupOpen: false })).toBe("code");
  });

  it("an unknown address with sign-up closed gets the invite-only email, not a code", () => {
    expect(signInEmailKind({ accountExists: false, fromInvite: false, signupOpen: false })).toBe("invite-only");
  });

  it("an unknown address with sign-up open gets a code", () => {
    expect(signInEmailKind({ accountExists: false, fromInvite: false, signupOpen: true })).toBe("code");
  });
});

describe("mayCreateAccount (completing sign-in with no account yet)", () => {
  const live = { redeemedAt: null, revokedAt: null };

  it("closed: only through an invite that's still unredeemed and unrevoked", () => {
    expect(mayCreateAccount({ signupOpen: false, invite: live })).toBe(true);
    expect(mayCreateAccount({ signupOpen: false, invite: null })).toBe(false);
    expect(mayCreateAccount({ signupOpen: false, invite: { redeemedAt: new Date(), revokedAt: null } })).toBe(false);
    expect(mayCreateAccount({ signupOpen: false, invite: { redeemedAt: null, revokedAt: new Date() } })).toBe(false);
  });

  it("open: always", () => {
    expect(mayCreateAccount({ signupOpen: true, invite: null })).toBe(true);
    expect(mayCreateAccount({ signupOpen: true, invite: { redeemedAt: new Date(), revokedAt: null } })).toBe(true);
  });
});
