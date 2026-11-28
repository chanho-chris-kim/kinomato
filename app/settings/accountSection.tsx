import { getDb } from "@/db";
import { pendingEmailChange } from "@/app/emailChange";
import { readFormEcho } from "@/app/formEcho";
import { clashMessage } from "@/lib/displayName";
import {
  cancelEmailChangeAction,
  confirmEmailChangeAction,
  requestEmailChangeAction,
  updateName,
} from "./actions";

export type AccountParams = {
  error?: string;
  saved?: string;
  emailChange?: string;
  emailError?: string;
  nameTaken?: string;
};

// Account (u7): your display name (u2) and your email (§5.9, step 7b), as
// they were on the single Settings page. Shown on /settings/account, and
// beside the menu on /settings from 900px, where it's an h2 under the
// page's "Settings" h1.
export async function AccountSection({
  user,
  params,
  heading,
}: {
  user: { id: string; email: string; displayName: string | null };
  params: AccountParams;
  heading: "h1" | "h2";
}) {
  const { error, saved, emailChange: emailStatus, emailError, nameTaken } = params;
  // After a mistake, what was typed comes back from the form-echo cookie,
  // never the URL (app/formEcho.ts, §11.6); a clash's club and name too.
  const echo = error || nameTaken ? await readFormEcho() : {};
  const nameError = error ?? (nameTaken && echo.takenIn ? clashMessage(echo.takenIn, echo.displayName ?? "") : null);
  // eslint-disable-next-line react-hooks/purity -- a Server Component, once per request
  const pending = await pendingEmailChange(getDb(), user.id, new Date(Date.now()));
  // After a mistake, the form shows what was typed; otherwise the saved name.
  const displayName = nameError ? (echo.displayName ?? "") : (user.displayName ?? "");
  const Title = heading;

  return (
    <>
      <Title className="h-display page-title">Account</Title>

      <section className="card mt14" aria-labelledby="your-name">
        {/* Not "Display name": that's the field's label (u2). */}
        <h2 id="your-name" className="sec flush">
          Your name
        </h2>
        <p id="display-name-hint" className="small muted mt-1 flush">
          How you&apos;ll show up in your clubs. A nickname is fine.
        </p>
        {nameError && (
          <p className="small mt-1 warn" role="alert">
            {nameError}
          </p>
        )}
        {saved === "name" && !nameError && (
          <p className="small mt-1 saved-note" role="status">
            Saved.
          </p>
        )}
        <form action={updateName} className="name-row mt14">
          <label className="small muted name-first">
            Display name
            <div className="search mt-1">
              <input
                name="displayName"
                defaultValue={displayName}
                required
                maxLength={30}
                autoComplete="nickname"
                aria-describedby="display-name-hint"
              />
            </div>
          </label>
          <button type="submit" className="btn">
            Save name
          </button>
        </form>
      </section>

      <section className="card mt14" aria-labelledby="your-email">
        <h2 id="your-email" className="sec flush">
          Email
        </h2>
        <p className="small mt-1 flush">
          <span className="muted">Signed in as </span>
          <span className="current-email">{user.email}</span>
        </p>
        {emailError && (
          <p className="small mt-1 warn" role="alert">
            {emailError}
          </p>
        )}
        {emailStatus === "changed" && !emailError && (
          <p className="small mt-1 saved-note" role="status">
            Email changed. You&apos;re signed out everywhere else.
          </p>
        )}

        {pending ? (
          <div className="card now mt14 email-pending">
            <p className="small flush">
              {pending.state === "usable" ? (
                <>
                  Code sent to <span className="masked-email">{pending.maskedNewEmail}</span>. Enter it to switch. Until
                  then, your email stays the same.
                </>
              ) : (
                <>
                  The code for <span className="masked-email">{pending.maskedNewEmail}</span>{" "}
                  {pending.state === "expired" ? "has expired" : "is locked after too many wrong tries"}. Ask for a new
                  one.
                </>
              )}
            </p>
            {pending.state === "usable" && (
              <form action={confirmEmailChangeAction} className="row gap8 mt14 items-end">
                <label className="small muted grow min-w-0">
                  Code
                  <div className="search mt-1">
                    <input name="code" required inputMode="numeric" autoComplete="one-time-code" maxLength={12} />
                  </div>
                </label>
                <button type="submit" className="btn primary auto">
                  Confirm
                </button>
              </form>
            )}
            <form action={cancelEmailChangeAction} className="mt14">
              <button type="submit" className="btn ghost auto">
                Cancel
              </button>
            </form>
          </div>
        ) : null}

        <form action={requestEmailChangeAction} className="row gap8 mt14 items-end">
          <label className="small muted grow min-w-0">
            {pending ? "Use a different address" : "New email address"}
            <div className="search mt-1">
              <input type="email" name="newEmail" required autoComplete="email" />
            </div>
          </label>
          <button type="submit" className="btn auto whitespace-nowrap">
            {pending ? "Send code" : "Change"}
          </button>
        </form>
      </section>
    </>
  );
}
