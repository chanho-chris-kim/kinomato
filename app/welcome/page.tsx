import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { invites, users } from "@/db/schema";
import { safePath } from "@/app/baseUrl";
import { getSessionUserId } from "@/app/session";
import { parseInviteeName } from "@/lib/invites";
import { saveName } from "./actions";

// Runs once, the first time an account with no name signs in
// (docs/onboarding-spec.md §5.6). Arriving from an invite, it's prefilled
// with the name the owner typed — a greeting only; the person sets their
// own.
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; invite?: string; error?: string; first?: string; initial?: string }>;
}) {
  const { next: rawNext, invite: inviteId, error, first, initial } = await searchParams;
  const next = safePath(rawNext);
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const userId = await getSessionUserId(db);
  if (!userId) redirect("/login");
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (user?.displayName) redirect(next);

  let suggested = { firstName: "", lastInitial: "" };
  let inviteeName: string | null = null;
  if (inviteId && /^[0-9a-f-]{36}$/i.test(inviteId)) {
    const [invite] = await db.select().from(invites).where(eq(invites.id, inviteId));
    if (invite) {
      inviteeName = invite.inviteeName;
      suggested = parseInviteeName(invite.inviteeName);
    }
  }

  return (
    <main className="p-4" style={{ maxWidth: 440, margin: "0 auto" }}>
      <div className="card" style={{ padding: "20px 18px" }}>
        <p className="eyebrow">One more thing</p>
        <h1 className="h-display" style={{ fontSize: 28 }}>
          What should your club call you?
        </h1>
        <p className="small muted mt-1">First name and last initial. That&apos;s how you&apos;ll show up in every club.</p>
        {error && (
          <p className="small mt14" style={{ color: "var(--warn)" }}>
            {error}
          </p>
        )}
        <form action={saveName} className="stack gap14 mt20">
          <div className="row gap8">
            <label className="small muted" style={{ flex: 3 }}>
              First name
              <div className="search mt-1">
                <input name="firstName" required autoComplete="given-name" defaultValue={first ?? suggested.firstName} />
              </div>
            </label>
            <label className="small muted" style={{ flex: 1 }}>
              Last initial
              <div className="search mt-1">
                <input name="lastInitial" required maxLength={1} defaultValue={initial ?? suggested.lastInitial} />
              </div>
            </label>
          </div>
          <input type="hidden" name="next" value={next} />
          {inviteId && <input type="hidden" name="invite" value={inviteId} />}
          <button type="submit" className="btn primary">
            Continue
          </button>
          {inviteeName && (
            <p className="tiny dim" style={{ margin: 0 }}>
              You were invited as {inviteeName}. That&apos;s only the greeting — change it if it&apos;s not how you go.
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
