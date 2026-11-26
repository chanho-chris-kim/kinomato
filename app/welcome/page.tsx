import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { invites, users } from "@/db/schema";
import { safePath } from "@/app/baseUrl";
import { getSessionUserId } from "@/app/session";
import { clashMessage } from "@/lib/displayName";
import { saveWelcome } from "./actions";
import { consentGapsFor } from "@/app/consent";
import { ConsentFields } from "@/app/consentFields";
import { PublicShell } from "@/app/shell";
import { readFormEcho } from "@/app/formEcho";

// Runs once, the first time an account with no name signs in
// (docs/onboarding-spec.md §5.6): the name, then the consent controls
// (§11.1–§11.3, app/consentFields.tsx). One free-text display name (ruled
// 2026-11-25, u2). Arriving from an invite, it's prefilled with what the
// inviter typed — a greeting only; the person sets their own, and joining
// happens here once it's checked against the club's names. Exempt from the
// consent gate: it is where that gate sends a new account.
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string;
    invite?: string;
    error?: string;
    nameTaken?: string;
  }>;
}) {
  const { next: rawNext, invite: inviteId, error, nameTaken } = await searchParams;
  // After a mistake, what was typed comes back from the form-echo cookie,
  // never the URL (app/formEcho.ts, §11.6).
  const echo = error || nameTaken ? await readFormEcho() : {};
  const message = error ?? (nameTaken && echo.takenIn ? clashMessage(echo.takenIn, echo.displayName ?? "") : null);
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

  let suggested = "";
  if (inviteId && /^[0-9a-f-]{36}$/i.test(inviteId)) {
    const [invite] = await db.select().from(invites).where(eq(invites.id, inviteId));
    if (invite) suggested = invite.inviteeName;
  }

  return (
    <PublicShell>
      <main className="p-4" style={{ maxWidth: 440, margin: "0 auto" }}>
        <div className="card" style={{ padding: "20px 18px" }}>
          <p className="eyebrow">One more thing</p>
          <h1 className="h-display" style={{ fontSize: 28 }}>
            What should your club call you?
          </h1>
          {message && (
            <p className="small mt14 warn" role="alert">
              {message}
            </p>
          )}
          <form action={saveWelcome} className="consent-form stack gap14 mt20">
            <label className="small muted">
              Display name
              <div className="search mt-1">
                <input
                  name="displayName"
                  required
                  maxLength={30}
                  autoComplete="nickname"
                  aria-describedby="display-name-hint"
                  defaultValue={echo.displayName ?? suggested}
                />
              </div>
            </label>
            <p id="display-name-hint" className="tiny dim flush">
              How you&apos;ll show up in your clubs. A nickname is fine. You can change it in Settings.
            </p>
            <ConsentFields
              askAge={!user.ageBracket}
              askTerms
              licensing={user.ageBracket === "13_17" ? "never" : user.ageBracket ? "always" : "with-adult-age"}
              age={echo.age}
            />
            <input type="hidden" name="next" value={next} />
            {inviteId && <input type="hidden" name="invite" value={inviteId} />}
            <button type="submit" className="btn primary">
              Continue
            </button>
          </form>
        </div>
      </main>
    </PublicShell>
  );
}
