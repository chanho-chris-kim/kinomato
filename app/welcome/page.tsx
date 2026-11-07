import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { invites, users } from "@/db/schema";
import { safePath } from "@/app/baseUrl";
import { getSessionUserId } from "@/app/session";
import { parseInviteeName } from "@/lib/invites";
import { saveWelcome } from "./actions";
import { consentGapsFor } from "@/app/consent";
import { ConsentFields } from "@/app/consentFields";
import { PublicShell } from "@/app/shell";
import { readFormEcho } from "@/app/formEcho";

// Runs once, the first time an account with no name signs in
// (docs/onboarding-spec.md §5.6): the name, then the consent controls
// (§11.1–§11.3, app/consentFields.tsx). Arriving from an invite, the name
// is prefilled with what the owner typed — a greeting only; the person
// sets their own. Exempt from the consent gate: it is where that gate
// sends a new account.
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string;
    invite?: string;
    error?: string;
  }>;
}) {
  const { next: rawNext, invite: inviteId, error } = await searchParams;
  // After a mistake, what was typed comes back from the form-echo cookie,
  // never the URL (app/formEcho.ts, §11.6).
  const { first, initial, age } = error ? await readFormEcho() : {};
  const next = safePath(rawNext);
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) redirect("/login");
  if (user.displayName) {
    // Named already: anything still missing is /consent's to ask.
    const gaps = await consentGapsFor(db, user);
    redirect(gaps.length ? `/consent?${new URLSearchParams({ next })}` : next);
  }

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
    <PublicShell>
      <main className="p-4" style={{ maxWidth: 440, margin: "0 auto" }}>
        <div className="card" style={{ padding: "20px 18px" }}>
          <p className="eyebrow">One more thing</p>
          <h1 className="h-display" style={{ fontSize: 28 }}>
            What should your club call you?
          </h1>
          <p className="small muted mt-1">First name and last initial. That&apos;s how you&apos;ll show up in every club.</p>
          {error && (
            <p className="small mt14" role="alert" style={{ color: "var(--warn)" }}>
              {error}
            </p>
          )}
          <form action={saveWelcome} className="consent-form stack gap14 mt20">
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
            <ConsentFields
              askAge={!user.ageBracket}
              askTerms
              licensing={user.ageBracket === "13_17" ? "never" : user.ageBracket ? "always" : "with-adult-age"}
              age={age}
            />
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
    </PublicShell>
  );
}
