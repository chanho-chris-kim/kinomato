import { getDb } from "@/db";
import { requireUser } from "@/app/auth";
import { pendingEmailChange } from "@/app/emailChange";
import { GlobalShell } from "@/app/shell";
import { parseInviteeName } from "@/lib/invites";
import {
  cancelEmailChangeAction,
  confirmEmailChangeAction,
  requestEmailChangeAction,
  signOut,
  signOutEverywhere,
  updateName,
} from "./actions";

// Settings (docs/onboarding-spec.md §5.9): your name, your email, and both
// sign outs (rebuild steps 7a and 7b). Notifications wait for the
// notifications feature, and the Privacy and Terms links for those pages
// (§5.9 rulings). Nothing else goes here until it's built — no "coming
// soon".
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    first?: string;
    initial?: string;
    saved?: string;
    email?: string;
    emailError?: string;
  }>;
}) {
  const { error, first, initial, saved, email: emailStatus, emailError } = await searchParams;
  const user = await requireUser("/settings");
  // eslint-disable-next-line react-hooks/purity -- a Server Component, once per request
  const pending = await pendingEmailChange(getDb(), user.id, new Date(Date.now()));
  // After a mistake, the form shows what was typed; otherwise the saved name.
  const current = parseInviteeName(user.displayName ?? "");
  const firstName = error ? (first ?? "") : current.firstName;
  const lastInitial = error ? (initial ?? "") : current.lastInitial;

  return (
    <GlobalShell current="settings">
      <h1 className="h-display" style={{ fontSize: 22 }}>
        Settings
      </h1>

      <section className="mt20" aria-labelledby="your-name">
        <h2 id="your-name" className="sec">
          Your name
        </h2>
        <p className="small muted" style={{ margin: "4px 0 0" }}>
          First name and last initial. It&apos;s how you show up in every club.
        </p>
        {error && (
          <p className="small mt-1" role="alert" style={{ color: "var(--warn)" }}>
            {error}
          </p>
        )}
        {saved === "name" && !error && (
          <p className="small mt-1" role="status" style={{ color: "var(--accent)" }}>
            Saved.
          </p>
        )}
        <form action={updateName} className="row gap8 mt14" style={{ alignItems: "flex-end" }}>
          <label className="small muted" style={{ flex: 3, minWidth: 0 }}>
            First name
            <div className="search mt-1">
              <input name="firstName" defaultValue={firstName} required autoComplete="given-name" />
            </div>
          </label>
          <label className="small muted" style={{ flex: "0 0 92px", whiteSpace: "nowrap" }}>
            Last initial
            <div className="search mt-1">
              <input name="lastInitial" defaultValue={lastInitial} required maxLength={1} />
            </div>
          </label>
          <button type="submit" className="btn" style={{ width: "auto", whiteSpace: "nowrap" }}>
            Save name
          </button>
        </form>
      </section>

      <section className="mt20" aria-labelledby="your-email">
        <h2 id="your-email" className="sec">
          Email
        </h2>
        <p className="small" style={{ margin: "4px 0 0" }}>
          <span className="muted">Signed in as </span>
          <span className="current-email">{user.email}</span>
        </p>
        {emailError && (
          <p className="small mt-1" role="alert" style={{ color: "var(--warn)" }}>
            {emailError}
          </p>
        )}
        {emailStatus === "changed" && !emailError && (
          <p className="small mt-1" role="status" style={{ color: "var(--accent)" }}>
            Email changed. You&apos;re signed out everywhere else.
          </p>
        )}

        {pending ? (
          <div className="card mt14 email-pending">
            <p className="small" style={{ margin: 0 }}>
              {pending.state === "usable" ? (
                <>
                  Code sent to <span className="masked-email">{pending.maskedNewEmail}</span>. Enter it to
                  switch. Until then, your email stays the same.
                </>
              ) : (
                <>
                  The code for <span className="masked-email">{pending.maskedNewEmail}</span>{" "}
                  {pending.state === "expired" ? "has expired" : "is locked after too many wrong tries"}. Ask
                  for a new one.
                </>
              )}
            </p>
            {pending.state === "usable" && (
              <form action={confirmEmailChangeAction} className="row gap8 mt14" style={{ alignItems: "flex-end" }}>
                <label className="small muted" style={{ flex: 1, minWidth: 0 }}>
                  Code
                  <div className="search mt-1">
                    <input
                      name="code"
                      required
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={12}
                    />
                  </div>
                </label>
                <button type="submit" className="btn primary" style={{ width: "auto" }}>
                  Confirm
                </button>
              </form>
            )}
            <form action={cancelEmailChangeAction} className="mt14">
              <button type="submit" className="btn ghost" style={{ width: "auto" }}>
                Cancel
              </button>
            </form>
          </div>
        ) : null}

        <form action={requestEmailChangeAction} className="row gap8 mt14" style={{ alignItems: "flex-end" }}>
          <label className="small muted" style={{ flex: 1, minWidth: 0 }}>
            {pending ? "Use a different address" : "New email address"}
            <div className="search mt-1">
              <input type="email" name="newEmail" required autoComplete="email" />
            </div>
          </label>
          <button type="submit" className="btn" style={{ width: "auto", whiteSpace: "nowrap" }}>
            {pending ? "Send code" : "Change"}
          </button>
        </form>
      </section>

      <section className="mt20" aria-labelledby="signing-out">
        <h2 id="signing-out" className="sec">
          Signing out
        </h2>
        <div className="stack gap8 mt14" style={{ maxWidth: 360 }}>
          <form action={signOut}>
            <button type="submit" className="btn">
              Sign out
            </button>
          </form>
          <p className="tiny dim" style={{ margin: 0 }}>
            Signs out this browser only.
          </p>
          <form action={signOutEverywhere} className="mt14">
            <button type="submit" className="btn ghost">
              Sign out everywhere
            </button>
          </form>
          <p className="tiny dim" style={{ margin: 0 }}>
            Signs out every device and browser you&apos;re signed in on, this one included.
          </p>
        </div>
      </section>
    </GlobalShell>
  );
}
