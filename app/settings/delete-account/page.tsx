import { getDb } from "@/db";
import { requireUser } from "@/app/auth";
import { deletionPlanFor, pendingDeletion, type ClubOutcome } from "@/app/accountDeletion";
import { SettingsFrame } from "../settingsFrame";
import {
  cancelAccountDeletionAction,
  confirmAccountDeletionAction,
  requestAccountDeletionAction,
} from "../actions";

function outcome(club: ClubOutcome): string {
  switch (club.action) {
    case "leave":
      return `You'll leave ${club.clubName}.`;
    case "transfer":
      return `${club.newOwnerName} will become the owner of ${club.clubName}.`;
    case "delete_club":
      return `${club.clubName} will be deleted, with all its nights, ratings and history, because you're its last member.`;
  }
}

// Delete account (docs/onboarding-spec.md §11.4): exactly what happens to
// each club, then the code from the email. Since u7 the flow starts here
// ("Delete my account…" in the Settings menu), in --danger; what it does is
// unchanged.
export default async function DeleteAccountPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const user = await requireUser("/settings/delete-account");
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  // eslint-disable-next-line react-hooks/purity -- a Server Component, once per request
  const now = new Date(Date.now());
  const [plan, state] = await Promise.all([deletionPlanFor(db, user.id), pendingDeletion(db, user.id, now)]);

  return (
    <SettingsFrame user={user} current="delete">
      <h1 className="h-display page-title">Delete your account</h1>
      <p className="small muted mt-1">
        Your name, email, watchlist and limits are removed. Your past picks, votes and rating scores stay in your
        clubs as &ldquo;Former member&rdquo;. A club you own passes to another member, and a club you&apos;re the last
        member of is deleted. This can&apos;t be undone.
      </p>

      <section className="card mt14" aria-labelledby="your-clubs">
        <h2 id="your-clubs" className="sec flush">
          Your clubs
        </h2>
        {plan.length === 0 ? (
          <p className="small" style={{ margin: "4px 0 0" }}>
            You&apos;re not in any club.
          </p>
        ) : (
          <ul className="small deletion-plan" style={{ paddingLeft: 18, margin: "8px 0 0" }}>
            {plan.map((club) => (
              <li key={club.clubId} style={{ marginTop: 4 }}>
                {outcome(club)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card danger-card mt14" aria-labelledby="confirm-deletion">
        <h2 id="confirm-deletion" className="sec flush">
          Confirm
        </h2>
        {error && (
          <p className="small mt-1 warn" role="alert">
            {error}
          </p>
        )}
        {state === "usable" ? (
          <>
            <p className="small" style={{ margin: "4px 0 0" }}>
              Enter the code we emailed you. It expires in 15 minutes.
            </p>
            <form action={confirmAccountDeletionAction} className="row gap8 mt14" style={{ alignItems: "flex-end" }}>
              <label className="small muted" style={{ flex: 1, minWidth: 0 }}>
                Code
                <div className="search mt-1">
                  <input name="code" required inputMode="numeric" autoComplete="one-time-code" maxLength={12} />
                </div>
              </label>
              <button type="submit" className="btn danger auto whitespace-nowrap">
                Delete my account
              </button>
            </form>
            <div className="row gap8 mt14 wrap">
              <form action={cancelAccountDeletionAction}>
                <button type="submit" className="btn ghost auto">
                  Cancel
                </button>
              </form>
              {/* As /settings always offered before u7: a fresh code, which
                  counts toward the three a day. */}
              <form action={requestAccountDeletionAction}>
                <button type="submit" className="btn ghost auto">
                  Send me a new code
                </button>
              </form>
            </div>
          </>
        ) : (
          <>
            <p className="small" style={{ margin: "4px 0 0" }}>
              {state === "locked"
                ? "Too many wrong codes. Ask for a new one."
                : state === "expired"
                  ? "That code has expired. Ask for a new one."
                  : "Ask for a code to confirm."}
            </p>
            <form action={requestAccountDeletionAction} className="mt14">
              <button type="submit" className="btn danger auto">
                Send me a code
              </button>
            </form>
            {!state && (
              <p className="tiny dim mt-1 flush">
                We email a code to your address. Nothing is deleted until you enter it.
              </p>
            )}
            {state && (
              <form action={cancelAccountDeletionAction} className="mt14">
                <button type="submit" className="btn ghost" style={{ width: "auto" }}>
                  Cancel
                </button>
              </form>
            )}
          </>
        )}
      </section>
    </SettingsFrame>
  );
}
