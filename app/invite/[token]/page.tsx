import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { activeMemberCount, findActiveMembership, loadInviteByToken } from "@/app/invites";
import { getSessionUserId } from "@/app/session";
import { resolveInviteView } from "@/lib/invites";
import { inviteShareText } from "@/lib/inviteShare";
import { describeSchedule } from "@/lib/format";
import { DEFAULT_OPEN_GRAPH } from "@/app/metadata";
import type { Metadata } from "next";
import { joinInviteAsMe, joinInviteWithName, signOutForInvite, startInvite } from "./actions";
import { readFormEcho } from "@/app/formEcho";
import { clashMessage, shownName } from "@/lib/displayName";
import { PublicShell } from "@/app/shell";
import { StepBar } from "@/app/stepBar";
import { InviteCard } from "@/app/inviteCard";
import { SIGN_UP_STEPS } from "@/lib/steps";

// The invite landing page (docs/onboarding-spec.md §5.3) — the most
// important screen in the rebuild: "Hi Marco — Chris invited you to
// Saturday Club" before anyone types anything. Public. GET never records
// or redeems anything: chat apps' link previews open every URL.
// Link-preview text (docs/onboarding-spec.md §5.1; rebuild step 5e).
// Read-only, like the page: a chat app's preview fetch records nothing.
// A valid invite says who invited you to which club and when it meets;
// any other state keeps the generic defaults, nothing about any club.
// Never indexed: a personal link doesn't belong in a search engine.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const robots = { index: false, follow: false };
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const row = await loadInviteByToken(db, token);
  const text = row
    ? inviteShareText({
        invite: row.invite,
        activeMemberCount: await activeMemberCount(db, row.club.id),
        inviterName: row.inviterName,
        clubName: row.club.name,
        scheduleLine: describeSchedule(row.club),
      })
    : null;
  if (!text) return { robots };
  return {
    robots,
    openGraph: { ...DEFAULT_OPEN_GRAPH, title: text.title, description: text.description },
  };
}

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string; nameTaken?: string }>;
}) {
  const { token } = await params;
  const { error, nameTaken } = await searchParams;
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts

  const row = await loadInviteByToken(db, token);
  const userId = await getSessionUserId();
  const [viewer] = userId ? await db.select().from(users).where(eq(users.id, userId)) : [];
  const view = resolveInviteView({
    invite: row?.invite ?? null,
    activeMemberCount: row ? await activeMemberCount(db, row.club.id) : 0,
    viewer: viewer
      ? { isActiveMember: row ? !!(await findActiveMembership(db, row.club.id, viewer.id)) : false }
      : null,
  });

  // The name the inviter typed: a greeting only (ruled 2026-11-25).
  const inviteeName = row?.invite.inviteeName ?? "";
  const clubName = row?.club.name ?? "";
  const inviterName = row?.inviterName ?? "the club";

  const card = (children: React.ReactNode) => (
    <PublicShell>
      <main className="p-4" style={{ maxWidth: 440, margin: "0 auto" }}>
        <div className="card" style={{ padding: "20px 18px" }}>
          {children}
        </div>
      </main>
    </PublicShell>
  );

  if (view === "replaced") {
    return card(
      <>
        {clubName && <p className="eyebrow">{clubName}</p>}
        <h1 className="h-display" style={{ fontSize: 26 }}>
          This invite link was replaced
        </h1>
        <p className="small muted mt-1">
          {row ? `Ask ${inviterName} for a new one.` : "Ask whoever sent it for a new one."}
        </p>
      </>,
    );
  }

  // Past "replaced", the invite row exists.
  const { club } = row!;

  if (view === "already_member") {
    return card(
      <>
        <p className="eyebrow">{club.name}</p>
        <h1 className="h-display" style={{ fontSize: 26 }}>
          You&apos;re already in {club.name}
        </h1>
        <p className="small muted mt-1">
          This invite is {inviteeName}&apos;s, so opening it didn&apos;t use it up.
        </p>
        <Link href={`/clubs/${club.id}`} className="btn primary mt20" style={{ display: "block", textAlign: "center" }}>
          Go to {club.name}
        </Link>
      </>,
    );
  }

  if (view === "used") {
    return card(
      <>
        <p className="eyebrow">{club.name}</p>
        <h1 className="h-display" style={{ fontSize: 26 }}>
          {inviteeName}&apos;s invite has already been used
        </h1>
        <p className="small muted mt-1">If you&apos;re {inviteeName}, sign in and you&apos;ll land in the club.</p>
        <Link
          href={`/login?${new URLSearchParams({ returnTo: `/clubs/${club.id}` })}`}
          className="btn primary mt20"
          style={{ display: "block", textAlign: "center" }}
        >
          Sign in
        </Link>
      </>,
    );
  }

  if (view === "full") {
    return card(
      <>
        <p className="eyebrow">{club.name}</p>
        <h1 className="h-display" style={{ fontSize: 26 }}>
          {club.name} is full right now
        </h1>
        <p className="small muted mt-1">
          This link hasn&apos;t been used up. It will work again if a seat opens.
        </p>
      </>,
    );
  }

  if (view === "signed_in_other" && nameTaken) {
    // Joining with a display name someone in the club already has (ruled
    // 2026-11-25): pick another, which is the account's one name, then join.
    const echo = await readFormEcho();
    const message =
      error ??
      (echo.takenIn
        ? clashMessage(echo.takenIn, echo.displayName ?? "")
        : clashMessage(club.name, shownName(viewer!.displayName)));
    return card(
      <>
        <p className="eyebrow">{club.name}</p>
        <h1 className="h-display" style={{ fontSize: 26 }}>
          Pick another display name
        </h1>
        <p className="small mt14 warn name-taken" role="alert">
          {message}
        </p>
        <form action={joinInviteWithName.bind(null, token)} className="stack gap14 mt20">
          <label className="small muted">
            Display name
            <div className="search mt-1">
              <input name="displayName" required maxLength={30} defaultValue={echo.displayName ?? ""} />
            </div>
          </label>
          <p className="tiny dim flush">It&apos;s how you show up in all your clubs. A nickname is fine.</p>
          <button type="submit" className="btn primary">
            Join {club.name}
          </button>
        </form>
      </>,
    );
  }

  if (view === "signed_in_other") {
    // Ruling B (spec §7.4): show both identities, never redeem silently,
    // and make the choice that protects the invitee the primary one.
    const me = viewer!.displayName ?? viewer!.email;
    return card(
      <>
        <p className="eyebrow">{club.name}</p>
        <h1 className="h-display" style={{ fontSize: 26 }}>
          This invite is for {inviteeName}
        </h1>
        <p className="small muted mt-1">You&apos;re signed in as {me}.</p>
        <form action={signOutForInvite.bind(null, token)} className="mt20">
          <button type="submit" className="btn primary">
            Sign out and continue as {inviteeName}
          </button>
        </form>
        <form action={joinInviteAsMe.bind(null, token)} className="mt14">
          <button type="submit" className="btn ghost">
            Join {club.name} as {me} instead
          </button>
        </form>
        <p className="tiny dim mt14" style={{ margin: "14px 0 0" }}>
          If you join as yourself, {inviteeName} will need a new link from {inviterName}.
        </p>
      </>,
    );
  }

  // Signed out: the first step of an invited sign-up (u3, §5.13).
  return (
    <PublicShell>
      <main className="p-4 signin-main">
        <StepBar steps={SIGN_UP_STEPS} current={0} label="Signing up" className="signup-steps" />
        <InviteCard inviterName={inviterName} clubName={club.name} />
        <div className="card mt14 signin-card">
          <h1 className="h-display pitch-title">Hi {inviteeName}</h1>
          <p className="muted mt-1">Let&apos;s get you into the club. It takes about a minute.</p>
          {error && (
            <p className="small mt14 warn" role="alert">
              {error}
            </p>
          )}
          <form action={startInvite.bind(null, token)} className="stack gap14 mt20">
            <label className="small muted">
              Your email
              <div className="search mt-1">
                <input type="email" name="email" required autoComplete="email" placeholder="you@example.com" />
              </div>
            </label>
            <button type="submit" className="btn primary">
              Send my code
            </button>
          </form>
          <ul className="promises plain-list mt14">
            <li>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="5" y="11" width="14" height="9" rx="2" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </svg>
              <span>No password, ever. We email you a 6-digit code each time.</span>
            </li>
            <li>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 3l18 18" />
                <path d="M10.6 6.1A9.7 9.7 0 0 1 12 6c5 0 8.5 4.5 9 6-.3.9-1.2 2.3-2.6 3.6M6.3 7.6C4.5 8.9 3.3 10.7 3 12c.5 1.5 4 6 9 6 1.5 0 2.9-.4 4.1-1" />
              </svg>
              <span>No trackers following you around. Ever.</span>
            </li>
          </ul>
        </div>
        <p className="tiny dim mt14 center">
          Not {inviteeName}? Ask {inviterName} for your own link.
        </p>
      </main>
    </PublicShell>
  );
}
