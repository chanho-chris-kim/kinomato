import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { activeMemberCount, findActiveMembership, loadInviteByToken } from "@/app/invites";
import { getSessionUserId } from "@/app/session";
import { resolveInviteView } from "@/lib/invites";
import { joinInviteAsMe, signOutForInvite, startInvite } from "./actions";

// The invite landing page (docs/onboarding-spec.md §5.3) — the most
// important screen in the rebuild: "Hi Marco — Chris invited you to
// Saturday Club" before anyone types anything. Public. GET never records
// or redeems anything: chat apps' link previews open every URL.
//
// "Signed in" means a session. A guest with only a per-club identity
// cookie is signed out here, same as everywhere else sign-in is asked for.
export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts

  const row = await loadInviteByToken(db, token);
  const userId = await getSessionUserId(db);
  const [viewer] = userId ? await db.select().from(users).where(eq(users.id, userId)) : [];
  const view = resolveInviteView({
    invite: row?.invite ?? null,
    activeMemberCount: row ? await activeMemberCount(db, row.club.id) : 0,
    viewer: viewer
      ? { isActiveMember: row ? !!(await findActiveMembership(db, row.club.id, viewer.id)) : false }
      : null,
  });

  const inviteeFirst = row?.invite.inviteeName.replace(/ [A-Za-z]\.$/, "") ?? "";
  const clubName = row?.club.name ?? "";
  const inviterName = row?.inviterName ?? "the club";

  const card = (children: React.ReactNode) => (
    <main className="p-4" style={{ maxWidth: 440, margin: "0 auto" }}>
      <div className="card" style={{ padding: "20px 18px" }}>
        {children}
      </div>
    </main>
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
          This invite is {inviteeFirst}&apos;s, so opening it didn&apos;t use it up.
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
          {inviteeFirst}&apos;s invite has already been used
        </h1>
        <p className="small muted mt-1">If you&apos;re {inviteeFirst}, sign in and you&apos;ll land in the club.</p>
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

  if (view === "signed_in_other") {
    // Ruling B (spec §7.4): show both identities, never redeem silently,
    // and make the choice that protects the invitee the primary one.
    const me = viewer!.displayName ?? viewer!.email;
    return card(
      <>
        <p className="eyebrow">{club.name}</p>
        <h1 className="h-display" style={{ fontSize: 26 }}>
          This invite is for {inviteeFirst}
        </h1>
        <p className="small muted mt-1">You&apos;re signed in as {me}.</p>
        <form action={signOutForInvite.bind(null, token)} className="mt20">
          <button type="submit" className="btn primary">
            Sign out and continue as {inviteeFirst}
          </button>
        </form>
        <form action={joinInviteAsMe.bind(null, token)} className="mt14">
          <button type="submit" className="btn ghost">
            Join {club.name} as {me} instead
          </button>
        </form>
        <p className="tiny dim mt14" style={{ margin: "14px 0 0" }}>
          If you join as yourself, {inviteeFirst} will need a new link from {inviterName}.
        </p>
      </>,
    );
  }

  return card(
    <>
      <p className="eyebrow">You&apos;re invited</p>
      <h1 className="h-display" style={{ fontSize: 32 }}>
        Hi {inviteeFirst}
      </h1>
      <p className="muted mt-1">
        {inviterName} invited you to <strong>{club.name}</strong>.
      </p>
      {error && (
        <p className="small mt14" style={{ color: "var(--warn)" }}>
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
          Continue
        </button>
        <p className="tiny dim" style={{ margin: 0 }}>
          We&apos;ll email you a 6-digit code. No password, ever.
        </p>
      </form>
      <p className="tiny dim mt14" style={{ textAlign: "center" }}>
        Not {inviteeFirst}? Ask {inviterName} for your own link.
      </p>
    </>,
  );
}
