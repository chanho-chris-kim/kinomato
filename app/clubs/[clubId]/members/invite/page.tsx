import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { clubs, invites } from "@/db/schema";
import { getBaseUrl } from "@/app/baseUrl";
import { requireClubMember } from "@/app/auth";
import { activeMemberCount } from "@/app/invites";
import { GlobalShell } from "@/app/shell";
import { FREE_TIER_MEMBER_CAP } from "@/lib/clubMembers";
import { createInvite, revokeInvite } from "../../actions";
import { ShareInvite } from "../../ShareInvite";

// Invite people (u4, §5.13): owners and admins, as on the Members tab, with
// the same server rules (the seat cap, revoke), re-checked in the actions.
// The normal app shell (the bottom tab bar on phones), a way back to the
// club, the new link highlighted, and who hasn't joined yet.
export default async function InvitePeoplePage({
  params,
  searchParams,
}: {
  params: Promise<{ clubId: string }>;
  searchParams: Promise<{ invite?: string; inviteError?: string }>;
}) {
  const { clubId } = await params;
  const { invite: newInviteId, inviteError } = await searchParams;
  const { membership } = await requireClubMember(clubId, `/clubs/${clubId}/members/invite`);
  if (membership.role !== "owner" && membership.role !== "admin") redirect(`/clubs/${clubId}/members`);
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const [[club], active, pending, baseUrl] = await Promise.all([
    db.select({ id: clubs.id, name: clubs.name }).from(clubs).where(eq(clubs.id, clubId)),
    activeMemberCount(db, clubId),
    db
      .select()
      .from(invites)
      .where(and(eq(invites.clubId, clubId), isNull(invites.redeemedAt), isNull(invites.revokedAt)))
      .orderBy(asc(invites.createdAt)),
    getBaseUrl(),
  ]);
  const seatsLeft = Math.max(0, FREE_TIER_MEMBER_CAP - active - pending.length);
  const fresh = pending.find((i) => i.id === newInviteId) ?? null;

  return (
    <GlobalShell current="clubs">
      <p className="small flush">
        <Link href={`/clubs/${clubId}`} className="tap back-link" aria-label={`Back to ${club.name}`}>
          <span aria-hidden="true">←</span> {club.name}
        </Link>
      </p>
      <h1 className="h-display stage-title mt14">Who&apos;s coming to {club.name}?</h1>
      <p className="small muted mt-1 seats-left">
        Each person gets their own link.{" "}
        {seatsLeft === 0 ? "No seats left." : `${seatsLeft} ${seatsLeft === 1 ? "seat" : "seats"} left.`}
      </p>
      {inviteError && (
        <p className="small mt14 warn" role="alert">
          {inviteError}
        </p>
      )}

      {fresh && (
        <section className="card now mt14 fresh-invite" aria-labelledby="fresh-heading">
          <h2 id="fresh-heading" className="sec">
            Link for {fresh.inviteeName} is ready
          </h2>
          <ShareInvite url={`${baseUrl}/invite/${fresh.token}`} inviteeName={fresh.inviteeName} clubName={club.name} separate />
          <p className="tiny dim mt14 flush">Only {fresh.inviteeName} should use this link. It works once.</p>
        </section>
      )}

      {seatsLeft > 0 && (
        <form action={createInvite.bind(null, clubId)} className="stack gap8 mt20">
          <input type="hidden" name="from" value="invite" />
          <label className="small muted">
            Their name
            <div className="search mt-1">
              <input name="inviteeName" required maxLength={30} aria-describedby="invitee-name-hint" />
            </div>
          </label>
          <p id="invitee-name-hint" className="tiny dim flush">
            So the invite can greet them. They&apos;ll choose their own display name when they join.
          </p>
          <button type="submit" className={`btn ${fresh ? "" : "primary"}`}>
            Create invite link
          </button>
        </form>
      )}

      {pending.length > 0 && (
        <section className="mt20" aria-labelledby="waiting-heading">
          <h2 id="waiting-heading" className="sec">
            Waiting to join
          </h2>
          <ul className="stack gap8 plain-list waiting-list">
            {pending.map((invite) => (
              <li key={invite.id} className="card row gap8">
                <span className="grow small">{invite.inviteeName}</span>
                <form action={revokeInvite.bind(null, clubId, invite.id, "invite")}>
                  <button type="submit" className="btn ghost limit-remove" aria-label={`Cancel ${invite.inviteeName}'s invite`}>
                    Cancel
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </GlobalShell>
  );
}
