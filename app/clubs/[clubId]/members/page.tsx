import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { clubs, invites } from "@/db/schema";
import { requireClubMember } from "@/app/auth";
import { getBaseUrl } from "@/app/baseUrl";
import { ClubHeader, ClubTabs, GlobalShell } from "@/app/shell";
import { FREE_TIER_MEMBER_CAP } from "@/lib/clubMembers";
import { timeAgo } from "@/lib/format";
import { canCreateInvite } from "@/lib/invites";
import { createInvite, regenerateInvite, revokeInvite } from "../actions";
import { byJoinedAt, MemberCards } from "../memberViews";
import { loadClubMemberships } from "../members";
import { ShareInvite } from "../ShareInvite";

// The Members tab (docs/onboarding-spec.md §5.10; rebuild step 5c). In
// order: Members, Invited (only when there are pending invites), Add a
// person (owners and admins). Nothing else until it's built: limits, club
// settings and leaving a club aren't (§8.5's step-5 rulings). No rail here:
// it would repeat the main column.
export default async function MembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ clubId: string }>;
  searchParams: Promise<{ invite?: string; inviteError?: string }>;
}) {
  const { clubId } = await params;
  const { invite: newInviteId, inviteError } = await searchParams;
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const now = new Date();

  // Signed in and an active member, or /login / 404 (§5.1).
  const { membership: me } = await requireClubMember(clubId, `/clubs/${clubId}/members`);
  const [club] = await db.select().from(clubs).where(eq(clubs.id, clubId));
  const activeMemberships = (await loadClubMemberships(db, clubId))
    .filter((m) => m.leftAt === null)
    .sort(byJoinedAt);

  // Pending invites: every member sees who's coming; Share/Regenerate/
  // Revoke are owners' and admins' only (Ruling C).
  const isOwnerOrAdmin = me.role === "owner" || me.role === "admin";
  const pendingInvites = await db
    .select()
    .from(invites)
    .where(and(eq(invites.clubId, clubId), isNull(invites.redeemedAt), isNull(invites.revokedAt)))
    .orderBy(asc(invites.createdAt));
  const baseUrl = await getBaseUrl();
  const seatsTaken = activeMemberships.length + pendingInvites.length;

  return (
    <GlobalShell
      current="clubs"
      header={
        <>
          <ClubHeader club={club} />
          <ClubTabs clubId={clubId} current="members" />
        </>
      }
    >
      <h2 className="sec mt14">Members</h2>
      <MemberCards members={activeMemberships} meId={me.id} />

      {pendingInvites.length > 0 && (
        <>
          <h2 className="sec mt20">Invited</h2>
          <div className="stack gap8">
            {pendingInvites.map((invite) => (
              <div
                key={invite.id}
                className="card"
                style={invite.id === newInviteId ? { borderColor: "var(--accent)" } : undefined}
              >
                <div className="between">
                  <span>{invite.inviteeName}</span>
                  <span className="tiny dim">{timeAgo(invite.createdAt, now)}</span>
                </div>
                <p className="tiny dim" style={{ margin: "3px 0 0" }}>
                  {invite.startedAt ? "Started: entered an email" : "Not started"}
                </p>
                {invite.id === newInviteId && (
                  <p className="tiny mt-1" style={{ color: "var(--accent)" }}>
                    Invite ready. Send it to {invite.inviteeName} directly: whoever uses it first
                    gets the seat.
                  </p>
                )}
                {isOwnerOrAdmin && (
                  <div className="stack gap8 mt14">
                    <ShareInvite
                      url={`${baseUrl}/invite/${invite.token}`}
                      inviteeName={invite.inviteeName}
                      clubName={club.name}
                    />
                    <div className="row gap8">
                      <form action={regenerateInvite.bind(null, clubId, invite.id)} style={{ flex: 1 }}>
                        <button type="submit" className="btn ghost">
                          Regenerate
                        </button>
                      </form>
                      <form action={revokeInvite.bind(null, clubId, invite.id)} style={{ flex: 1 }}>
                        <button type="submit" className="btn ghost">
                          Revoke
                        </button>
                      </form>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {isOwnerOrAdmin && (
        <section id="add-person" className="mt20">
          <h2 className="sec">Add a person</h2>
          <p className="small muted">
            {seatsTaken} of {FREE_TIER_MEMBER_CAP} seats. Each person gets their own link that greets
            them by name.
          </p>
          {inviteError && (
            <p className="small mt-1" style={{ color: "var(--warn)" }}>
              {inviteError}
            </p>
          )}
          {canCreateInvite(activeMemberships.length, pendingInvites.length) ? (
            <form
              action={createInvite.bind(null, clubId)}
              className="row gap8 mt14"
              style={{ alignItems: "flex-end" }}
            >
              <label className="small muted" style={{ flex: 3, minWidth: 0 }}>
                First name
                <div className="search mt-1">
                  <input name="firstName" required />
                </div>
              </label>
              <label className="small muted" style={{ flex: 1, minWidth: 0 }}>
                Last initial
                <div className="search mt-1">
                  <input name="lastInitial" required maxLength={1} />
                </div>
              </label>
              <button type="submit" className="btn" style={{ width: "auto", whiteSpace: "nowrap" }}>
                Create invite
              </button>
            </form>
          ) : (
            <p className="small mt14">
              {club.name} is full: {activeMemberships.length} members and {pendingInvites.length}{" "}
              pending {pendingInvites.length === 1 ? "invite" : "invites"}. Revoke an invite to free
              a seat.
            </p>
          )}
        </section>
      )}
    </GlobalShell>
  );
}
