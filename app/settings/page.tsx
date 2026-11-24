import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { clubs, memberships } from "@/db/schema";
import { requireUser } from "@/app/auth";
import { pendingEmailChange } from "@/app/emailChange";
import { licensingStatusFor } from "@/app/consent";
import { canOptInToLicensing, isLicensingActive } from "@/lib/consent";
import { currentLegal } from "@/lib/legal";
import { GlobalShell } from "@/app/shell";
import { readFormEcho } from "@/app/formEcho";
import { parseInviteeName } from "@/lib/invites";
import {
  cancelEmailChangeAction,
  requestAccountDeletionAction,
  confirmEmailChangeAction,
  optInToLicensingAction,
  requestEmailChangeAction,
  setClubRemindersMuted,
  setEmailReminders,
  signOut,
  signOutEverywhere,
  updateName,
  withdrawFromLicensingAction,
} from "./actions";

// Settings (docs/onboarding-spec.md §5.9): your name, your email, How we
// reach you (reminder emails and per-club mutes, ruled 2026-11-23), data
// sharing for 18 or older (§11.2), Download my data (§11.5), both sign
// outs, and Delete account (§11.4) (rebuild steps 7a and
// 7b, launch foundations (c)). Web Push waits for its own feature, and the Privacy and Terms links for those pages
// (§5.9 rulings). Nothing else goes here until it's built — no "coming
// soon".
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    saved?: string;
    emailChange?: string;
    emailError?: string;
    sharing?: string;
    deleteError?: string;
  }>;
}) {
  const { error, saved, emailChange: emailStatus, emailError, sharing, deleteError } = await searchParams;
  // After a mistake, what was typed comes back from the form-echo cookie,
  // never the URL (app/formEcho.ts, §11.6).
  const { first, initial } = error ? await readFormEcho() : {};
  const user = await requireUser("/settings");
  // eslint-disable-next-line react-hooks/purity -- a Server Component, once per request
  const pending = await pendingEmailChange(getDb(), user.id, new Date(Date.now()));
  // 13–17 never sees Data sharing at all (§11.2).
  const canShare = canOptInToLicensing(user.ageBracket);
  const licensing = canShare ? await licensingStatusFor(getDb(), user.id) : null;
  const sharingNow =
    canShare && licensing ? isLicensingActive(licensing.rows, user.ageBracket, currentLegal().licensing.version) : false;
  // The viewer's active clubs, for the per-club reminder mute.
  const reminderClubs = (
    await getDb()
      .select({ clubId: clubs.id, clubName: clubs.name, mutedAt: memberships.remindersMutedAt })
      .from(memberships)
      .innerJoin(clubs, eq(memberships.clubId, clubs.id))
      .where(and(eq(memberships.userId, user.id), isNull(memberships.leftAt)))
  )
    .map((c) => ({ clubId: c.clubId, clubName: c.clubName, muted: c.mutedAt !== null }))
    .sort((a, b) => a.clubName.localeCompare(b.clubName));
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
        <form action={updateName} className="name-row mt14">
          <label className="small muted name-first">
            First name
            <div className="search mt-1">
              <input name="firstName" defaultValue={firstName} required autoComplete="given-name" />
            </div>
          </label>
          <label className="small muted name-initial">
            Last initial
            <div className="search mt-1">
              <input name="lastInitial" defaultValue={lastInitial} required maxLength={1} />
            </div>
          </label>
          <button type="submit" className="btn">
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

      {/* How we reach you (§5.9, ruled 2026-11-23). Email is the only
          channel for now. */}
      <section className="mt20" aria-labelledby="reminders-heading" id="reminders">
        <h2 id="reminders-heading" className="sec">
          How we reach you
        </h2>
        {saved === "reminders" && (
          <p className="small mt-1" role="status" style={{ color: "var(--accent)" }}>
            Saved.
          </p>
        )}
        <div className="between mt14" style={{ alignItems: "center", gap: 12 }}>
          <span className="small reminder-emails-status">
            Reminder emails: <strong>{user.emailReminders ? "on" : "off"}</strong>
          </span>
          <form action={setEmailReminders.bind(null, !user.emailReminders)}>
            <button type="submit" className="btn" style={{ width: "auto" }}>
              {user.emailReminders ? "Turn off" : "Turn on"}
            </button>
          </form>
        </div>
        {reminderClubs.length > 0 && (
          <ul className="stack gap8 mt14 reminder-mutes" style={{ listStyle: "none", padding: 0, margin: "14px 0 0" }}>
            {reminderClubs.map((c) => (
              <li key={c.clubId} className="between" style={{ alignItems: "center", gap: 12 }}>
                <span className="small">
                  {c.clubName}
                  {c.muted && <span className="dim"> · muted</span>}
                </span>
                <form action={setClubRemindersMuted.bind(null, c.clubId, !c.muted)}>
                  <button type="submit" className="btn ghost" style={{ width: "auto" }}>
                    {c.muted ? `Unmute reminders from ${c.clubName}` : `Mute reminders from ${c.clubName}`}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <p className="tiny dim" style={{ margin: "12px 0 0" }}>
          Sign-in codes and account notices always arrive.
        </p>
      </section>

      {canShare && licensing && (
        <section className="mt20" aria-labelledby="data-sharing">
          <h2 id="data-sharing" className="sec">
            Data sharing
          </h2>
          {sharing && (
            <p className="small mt-1" role="status" style={{ color: "var(--accent)" }}>
              {sharing === "on" ? "You're sharing." : "Withdrawn."}
            </p>
          )}
          <p className="small data-sharing-status" style={{ margin: "4px 0 0" }}>
            {sharingNow
              ? "You're sharing, in anonymous aggregates only."
              : licensing.status.withdrawnAt
                ? "You're not sharing. You withdrew, so nothing new of yours goes into an aggregate."
                : "You're not sharing."}
          </p>
          <p className="tiny dim" style={{ margin: "8px 0 0" }}>
            {currentLegal().licensing.text}
          </p>
          {sharingNow ? (
            <>
              <form action={withdrawFromLicensingAction} className="mt14">
                <button type="submit" className="btn" style={{ width: "auto" }}>
                  Withdraw
                </button>
              </form>
              <p className="tiny dim" style={{ margin: "8px 0 0" }}>
                Withdrawing applies from now on: your data stops going into new aggregates, but ones
                already made can&apos;t be recalled.
              </p>
            </>
          ) : (
            <form action={optInToLicensingAction} className="mt14">
              <button type="submit" className="btn" style={{ width: "auto" }}>
                Opt in
              </button>
            </form>
          )}
        </section>
      )}

      <section className="mt20" aria-labelledby="your-data">
        <h2 id="your-data" className="sec">
          Your data
        </h2>
        <p className="small muted" style={{ margin: "4px 0 0" }}>
          Everything Kinomato holds that&apos;s yours, as one JSON file: your account and reminder settings,
          clubs, watchlist, ratings, nominations, RSVPs, limits and preferences, and your own votes and
          vetoes. Never anyone else&apos;s.
        </p>
        {/* A plain link, not next/link: it's a file download from a route
            handler (app/settings/export/route.ts), never prefetched. */}
        <a href="/settings/export" download className="btn mt14" style={{ display: "inline-block", width: "auto" }}>
          Download my data
        </a>
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

      <section className="mt20" aria-labelledby="delete-account-heading" id="delete-account">
        <h2 id="delete-account-heading" className="sec">
          Delete account
        </h2>
        <p className="small muted" style={{ margin: "4px 0 0" }}>
          Your name, email, watchlist and limits are removed, and your past picks, votes and rating scores
          stay in your clubs as &ldquo;Former member&rdquo;. A club you own passes to another member, and a
          club you&apos;re the last member of is deleted.
        </p>
        {deleteError && (
          <p className="small mt-1" role="alert" style={{ color: "var(--warn)" }}>
            {deleteError}
          </p>
        )}
        <form action={requestAccountDeletionAction} className="mt14">
          <button type="submit" className="btn ghost" style={{ width: "auto" }}>
            Send me a code
          </button>
        </form>
        <p className="tiny dim" style={{ margin: "8px 0 0" }}>
          We email a code to your address. Next you&apos;ll see what happens to each of your clubs before
          anything is deleted.
        </p>
      </section>
    </GlobalShell>
  );
}
