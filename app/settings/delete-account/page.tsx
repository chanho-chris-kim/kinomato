import { getDb } from "@/db";
import { requireUser } from "@/app/auth";
import { deletionPlanFor, pendingDeletion, type ClubOutcome } from "@/app/accountDeletion";
import { GlobalShell } from "@/app/shell";
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

// Delete account's confirmation (docs/onboarding-spec.md §11.4): exactly
// what happens to each club, then the code from the email.
export default async function DeleteAccountPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const user = await requireUser("/settings/delete-account");
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  // eslint-disable-next-line react-hooks/purity -- a Server Component, once per request
  const now = new Date(Date.now());
  const [plan, state] = await Promise.all([deletionPlanFor(db, user.id), pendingDeletion(db, user.id, now)]);

  return (
    <GlobalShell current="settings">
      <h1 className="h-display" style={{ fontSize: 22 }}>
        Delete your account
      </h1>
      <p className="small muted" style={{ margin: "4px 0 0" }}>
        Your name, email, watchlist and limits are removed. Your past picks, votes and rating scores stay in
        your clubs as &ldquo;Former member&rdquo;. This can&apos;t be undone.
      </p>

      <section className="mt20" aria-labelledby="your-clubs">
        <h2 id="your-clubs" className="sec">
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

      <section className="mt20" aria-labelledby="confirm-deletion">
        <h2 id="confirm-deletion" className="sec">
          Confirm
        </h2>
        {error && (
          <p className="small mt-1" role="alert" style={{ color: "var(--warn)" }}>
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
              <button type="submit" className="btn primary" style={{ width: "auto", whiteSpace: "nowrap" }}>
                Delete my account
              </button>
            </form>
            <form action={cancelAccountDeletionAction} className="mt14">
              <button type="submit" className="btn ghost" style={{ width: "auto" }}>
                Cancel
              </button>
            </form>
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
              <button type="submit" className="btn" style={{ width: "auto" }}>
                Send me a code
              </button>
            </form>
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
    </GlobalShell>
  );
}
