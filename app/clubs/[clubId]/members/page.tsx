import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { clubs, constraints, invites } from "@/db/schema";
import { requireClubMember } from "@/app/auth";
import { readFormEcho } from "@/app/formEcho";
import { pendingRequestsFor } from "@/app/joinRequests";
import { FREE_TIER_MEMBER_CAP } from "@/lib/clubMembers";
import { getNomineesPerTurn } from "@/lib/clubSettings";
import { planLeave } from "@/lib/clubLeave";
import { limitSummary } from "@/lib/constraintForm";
import { runsSummary, timeAgo } from "@/lib/format";
import { canCreateInvite } from "@/lib/invites";
import { formatJoinCode } from "@/lib/joinCode";
import { canChangeRole, canRemove, canTransferOwnership, roleLabel, type RoleMember } from "@/lib/roles";
import {
  approveJoinRequestAction,
  declineJoinRequestAction,
  deleteClubAsLastMember,
  leaveClub,
  setClubPaused,
} from "../actions";
import { loadClubMemberships, nameOf, type ClubMembership } from "../members";
import { byJoinedAt, initials } from "../memberViews";
import { MembersFrame, RowLink } from "./membersFrame";
import { OldAnchorRedirect } from "@/app/OldAnchorRedirect";

// The Members tab (u6, ruled 2026-11-27; sub-pages ruled 2026-11-24, all
// under the Members tab, §5.10). In order: Asking to join (owners and
// admins, while someone's asking), People, Just for you, Club settings
// (owners and admins; a plain member's "Club" card has How this club runs
// only), and Leave this club. From 900px two columns: Asking
// to join and People on the left; Just for you, Club settings and Leave on
// the right, in place of the club rail. Managing a person, your limits and
// how the club runs are pages of their own; every server check is the
// actions', unchanged.
const MOVED_SECTIONS: Record<string, string> = {
  "#limits": "/limits",
  "#limits-heading": "/limits",
  "#club-settings": "/settings",
  "#club-details": "/settings",
  "#join-code": "/settings#join-code",
  "#add-person": "/invite",
};

export default async function MembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ clubId: string }>;
  searchParams: Promise<{
    asking?: string;
    roles?: string;
    rolesError?: string;
    removed?: string;
    leave?: string;
    leaveError?: string;
    // Old links into the single page (before u6) that now have a page.
    transfer?: string;
    remove?: string;
  }>;
}) {
  const { clubId } = await params;
  const { asking, roles, rolesError, removed, leave, leaveError, transfer, remove } = await searchParams;
  if (transfer && /^[0-9a-f-]{36}$/i.test(transfer)) redirect(`/clubs/${clubId}/members/${transfer}?transfer=1`);
  if (remove && /^[0-9a-f-]{36}$/i.test(remove)) redirect(`/clubs/${clubId}/members/${remove}?remove=1`);

  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  // eslint-disable-next-line react-hooks/purity -- a Server Component, once per request
  const now = new Date(Date.now());
  // Signed in and an active member, or /login / 404 (§5.1).
  const { membership: me } = await requireClubMember(clubId, `/clubs/${clubId}/members`);
  const isOwnerOrAdmin = me.role === "owner" || me.role === "admin";
  const [[club], allMemberships, pendingInvites, myLimits, askingRequests] = await Promise.all([
    db.select().from(clubs).where(eq(clubs.id, clubId)),
    loadClubMemberships(db, clubId),
    db
      .select()
      .from(invites)
      .where(and(eq(invites.clubId, clubId), isNull(invites.redeemedAt), isNull(invites.revokedAt)))
      .orderBy(asc(invites.createdAt)),
    // The viewer's own limits, and only theirs (ruled 2026-11-12).
    db.select({ kind: constraints.kind }).from(constraints).where(eq(constraints.membershipId, me.id)),
    // Plain members never see who's asking.
    isOwnerOrAdmin ? pendingRequestsFor(db, clubId) : Promise.resolve([]),
  ]);
  const active = allMemberships.filter((m) => m.leftAt === null).sort(byJoinedAt);
  const askingEcho = asking === "refused" ? await readFormEcho() : {};

  // Who the viewer may manage (lib/roles.ts); the person's page offers
  // exactly these, and the actions check again.
  const asRole = (m: Pick<ClubMembership, "id" | "clubId" | "role" | "leftAt">): RoleMember => ({ membershipId: m.id, clubId: m.clubId, role: m.role, leftAt: m.leftAt });
  const mayManage = (m: ClubMembership) =>
    canChangeRole(asRole(me), asRole(m), "admin") ||
    canChangeRole(asRole(me), asRole(m), "member") ||
    canTransferOwnership(asRole(me), asRole(m)) ||
    canRemove(asRole(me), asRole(m));

  // Leaving (ruled 2026-11-11): the plan decides what the confirm offers.
  const others = active.filter((m) => m.id !== me.id);
  const leavePlan = planLeave(
    me.role,
    others.map((o) => ({ membershipId: o.id, role: o.role, joinedAt: o.joinedAt })),
  );
  const heir = leavePlan.kind === "transfer" ? others.find((o) => o.id === leavePlan.heirMembershipId) : undefined;

  const askingCard = isOwnerOrAdmin && (askingRequests.length > 0 || asking) && (
    <section id="asking" className="card mt14 asking-card" aria-labelledby="asking-heading">
      <h2 id="asking-heading" className="sec flush">
        Asking to join
      </h2>
      {asking === "refused" && askingEcho.askingError && (
        <p className="small mt-1 warn" role="alert">
          {askingEcho.askingError}
        </p>
      )}
      {asking === "approved" && (
        <p className="small mt-1 saved-note" role="status">
          They&apos;re in. We&apos;ve emailed them.
        </p>
      )}
      {asking === "declined" && (
        <p className="small mt-1" role="status">
          Declined.
        </p>
      )}
      {askingRequests.length === 0 ? (
        <p className="small muted mt-1 flush">Nobody&apos;s asking right now.</p>
      ) : (
        <ul className="plain-list stack gap8 mt14 asking-list">
          {askingRequests.map((r, i) => (
            <li key={r.id} className="person-row asking-row">
              <span className="avatar" aria-hidden="true">
                {initials(r.name)}
              </span>
              <span className="grow person-text">
                <span className="person-name">{r.name}</span>
                <span className="tiny dim">Used the club code · {timeAgo(r.createdAt, now)}</span>
              </span>
              <span className="row gap8 asking-actions">
                {/* The page's one filled button: the first request's. */}
                <form action={approveJoinRequestAction.bind(null, clubId, r.id)}>
                  <button type="submit" className={`btn auto ${i === 0 ? "primary" : ""}`} aria-label={`Let ${r.name} in`}>
                    Let them in
                  </button>
                </form>
                <form action={declineJoinRequestAction.bind(null, clubId, r.id)}>
                  <button type="submit" className="btn ghost auto" aria-label={`Decline ${r.name}`}>
                    Decline
                  </button>
                </form>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  const peopleCard = (
    <section id="roles" className="card mt14 people-card" aria-labelledby="people-heading">
      <div className="between">
        <h2 id="people-heading" className="sec flush">
          People · {active.length} of {FREE_TIER_MEMBER_CAP}
        </h2>
        {isOwnerOrAdmin && canCreateInvite(active.length, pendingInvites.length) && (
          <Link href={`/clubs/${clubId}/members/invite`} className="btn ghost auto invite-link">
            + Invite
          </Link>
        )}
      </div>
      {/* A full club says so instead of offering + Invite (the seat-cap
          ruling: a refused invite is never a silent no-op). */}
      {isOwnerOrAdmin && !canCreateInvite(active.length, pendingInvites.length) && (
        <p className="small mt-1 club-full">
          {club.name} is full: {active.length} {active.length === 1 ? "member" : "members"} and {pendingInvites.length}{" "}
          pending {pendingInvites.length === 1 ? "invite" : "invites"}. Cancel an invite to free a seat.
        </p>
      )}
      {rolesError && (
        <p className="small mt-1 warn" role="alert">
          {rolesError}
        </p>
      )}
      {roles === "transferred" && !rolesError && (
        <p className="small mt-1 saved-note" role="status">
          Done. You&apos;re an admin now.
        </p>
      )}
      {removed && (
        <p className="small mt-1 saved-note" role="status">
          Removed.
        </p>
      )}
      <ul className="plain-list mt14 people-list">
        {active.map((m) => {
          const name = nameOf(m);
          return (
            <li key={m.id} className={`person-row ${m.id === me.id ? "me" : ""}`}>
              <span className={`avatar ${m.id === me.id ? "me" : ""}`} aria-hidden="true">
                {initials(name)}
              </span>
              <span className="grow person-text">
                <span className="person-name">
                  {name}
                  {m.id === me.id && <span className="you"> (you)</span>}
                </span>
                <span className="tiny dim member-role">
                  {roleLabel(m.role)}
                  {m.postponedAt && <span className="passed-turn"> · Passed this turn</span>}
                </span>
              </span>
              {mayManage(m) && (
                <Link href={`/clubs/${clubId}/members/${m.id}`} className="manage-link" aria-label={`Manage ${name}`}>
                  <span aria-hidden="true">⋯</span>
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      {pendingInvites.length > 0 && (
        <ul className="plain-list mt14 invited-list">
          {pendingInvites.map((invite) => {
            // Opening the link records nothing (link previews open every
            // URL); only starting to sign up is known (§7).
            const line = `Invited: ${invite.inviteeName} · ${invite.startedAt ? "started signing up" : "not started yet"}`;
            return (
              <li key={invite.id} className="small">
                {isOwnerOrAdmin ? (
                  <Link href={`/clubs/${clubId}/members/invite?invite=${invite.id}`} className="row-link invited-row">
                    <span className="grow muted">{line}</span>
                    <span className="row-link-chevron" aria-hidden="true">
                      ›
                    </span>
                  </Link>
                ) : (
                  <span className="muted invited-row">{line}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  const justForYou = (
    <section className="card mt14 just-for-you" aria-labelledby="for-you-heading">
      <h2 id="for-you-heading" className="sec flush">
        Just for you
      </h2>
      <RowLink href={`/clubs/${clubId}/members/limits`} label="Your limits" value={limitSummary(myLimits)} className="mt-1" />
    </section>
  );

  const settingsCard = isOwnerOrAdmin && (
    <section className="card mt14 club-settings-card" aria-labelledby="club-settings-heading">
      <h2 id="club-settings-heading" className="sec flush">
        Club settings
      </h2>
      <RowLink
        href={`/clubs/${clubId}/members/settings`}
        label="How this club runs"
        value={runsSummary(club, getNomineesPerTurn(club.settings))}
        className="mt-1"
      />
      <RowLink
        href={`/clubs/${clubId}/members/settings#join-code`}
        label="Club code"
        value={club.joinCode ? `On · ${formatJoinCode(club.joinCode)}` : "Off"}
      />
      <RowLink href={`/clubs/${clubId}/members/settings/pause`} label="Pause the club" value={club.pausedAt ? "Paused" : "Running"} />
    </section>
  );

  // Everyone sees how the club runs (ruled 2026-11-10); a plain member's
  // page is read-only.
  const clubCard = !isOwnerOrAdmin && (
    <section className="card mt14 club-card" aria-labelledby="club-card-heading">
      <h2 id="club-card-heading" className="sec flush">
        Club
      </h2>
      <RowLink
        href={`/clubs/${clubId}/members/settings`}
        label="How this club runs"
        value={runsSummary(club, getNomineesPerTurn(club.settings))}
        className="mt-1"
      />
    </section>
  );

  const leaveSection = (
    <section id="leave" className="mt20" aria-labelledby="leave-heading">
      <h2 id="leave-heading" className="sr-only">
        Leave this club
      </h2>
      {leaveError && (
        <p className="small mt-1 warn" role="alert">
          {leaveError}
        </p>
      )}
      {!leave ? (
        <Link href={`/clubs/${clubId}/members?leave=1#leave`} className="btn danger block-link leave-link">
          Leave this club
        </Link>
      ) : leavePlan.kind === "last_member" ? (
        // The last active member can't simply leave (ruled 2026-11-11):
        // pause, or delete the club by typing its name.
        <div className="card danger-card leave-confirm">
          <p className="small flush">
            You&apos;re the last member of {club.name}, so you can&apos;t just leave it. Pause it to come back later, or
            delete it.
          </p>
          {!club.pausedAt && (
            <form action={setClubPaused.bind(null, clubId, true)} className="mt14">
              <button type="submit" className="btn auto">
                Pause the club
              </button>
            </form>
          )}
          <form action={deleteClubAsLastMember.bind(null, clubId)} className="stack gap8 mt14">
            <label className="small muted">
              To delete {club.name} and everything in it (every night, vote and rating), type its name
              <div className="search mt-1">
                <input type="text" name="confirmName" required autoComplete="off" />
              </div>
            </label>
            <button type="submit" className="btn danger auto">
              Delete this club
            </button>
          </form>
          <Link href={`/clubs/${clubId}/members`} className="btn ghost auto mt14">
            Cancel
          </Link>
        </div>
      ) : (
        <div className="card danger-card leave-confirm">
          <p className="small flush">Leave {club.name}? Your past picks, votes and ratings stay in its history.</p>
          {heir && <p className="small mt-1 flush">{nameOf(heir)} will become the owner.</p>}
          <div className="row gap8 mt14">
            <form action={leaveClub.bind(null, clubId, null)}>
              <button type="submit" className="btn danger auto">
                Leave
              </button>
            </form>
            <Link href={`/clubs/${clubId}/members`} className="btn ghost auto">
              Cancel
            </Link>
          </div>
          {heir && others.length > 1 && (
            <div className="mt14 choose-heir">
              <p className="tiny dim flush">Choose someone else</p>
              <div className="stack gap8 mt-1">
                {others
                  .filter((o) => o.id !== heir.id)
                  .map((o) => (
                    <form key={o.id} action={leaveClub.bind(null, clubId, o.id)}>
                      <button type="submit" className="btn ghost auto">
                        Leave and make {nameOf(o)} the owner
                      </button>
                    </form>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );

  return (
    <MembersFrame db={db} club={club} role={me.role} back={false} wide>
      {/* Before u6 the Members tab was one page (#limits, #club-settings, …). */}
      <OldAnchorRedirect base={`/clubs/${clubId}/members`} moved={MOVED_SECTIONS} />
      <div className="members-grid">
        <div className="members-col">
          {askingCard}
          {peopleCard}
        </div>
        <div className="members-col">
          {justForYou}
          {settingsCard}
          {clubCard}
          {leaveSection}
        </div>
      </div>
    </MembersFrame>
  );
}
