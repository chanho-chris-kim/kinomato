import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { clubs, invites } from "@/db/schema";
import { requireClubMember } from "@/app/auth";
import { getBaseUrl } from "@/app/baseUrl";
import { ClubHeader, ClubTabs, GlobalShell } from "@/app/shell";
import { FREE_TIER_MEMBER_CAP } from "@/lib/clubMembers";
import { timeAgo } from "@/lib/format";
import { canCreateInvite } from "@/lib/invites";
import { getConfirmAt, getNomineesPerTurn } from "@/lib/clubSettings";
import type { ConfirmAt } from "@/lib/confirmTiming";
import { createInvite, regenerateInvite, revokeInvite, setClubPaused, updateClubSettings } from "../actions";
import { byJoinedAt, MemberCards } from "../memberViews";
import { loadClubMemberships } from "../members";
import { ShareInvite } from "../ShareInvite";

// When "Did you watch it?" is asked (lib/confirmTiming.ts), in plain words.
const CONFIRM_AT_LABELS: Record<ConfirmAt, string> = {
  same_night: "That night",
  morning_after: "The next morning",
  manual_only: "Any time, even before the night",
};

// The Members tab (docs/onboarding-spec.md §5.10; rebuild step 5c, m1). In
// order: Members, Invited (only when there are pending invites), Add a
// person (owners and admins), How this club runs (everyone sees it; owners
// and admins change it). Not yet built: your limits in this club, and
// leaving. No rail here: it would repeat the main column. Its space is
// kept (reserveRail).
export default async function MembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ clubId: string }>;
  searchParams: Promise<{ invite?: string; inviteError?: string; settingsError?: string; saved?: string }>;
}) {
  const { clubId } = await params;
  const { invite: newInviteId, inviteError, settingsError, saved } = await searchParams;
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
  const nomineesPerTurn = getNomineesPerTurn(club.settings);
  const confirmAt = getConfirmAt(club.settings);

  return (
    <GlobalShell
      current="clubs"
      // No rail here (it would repeat the main column), but its space is
      // kept so Tonight ↔ Members doesn't shift the page at 1120px+.
      reserveRail
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

      {/* Your limits in this club (§5.10: hard limits and soft preferences,
          per membership) will sit here, above How this club runs. A later
          step; no UI yet. */}

      <section id="club-settings" className="mt20" aria-labelledby="club-settings-heading">
        <h2 id="club-settings-heading" className="sec">
          How this club runs
        </h2>
        {club.pausedAt && (
          <p className="small mt-1 club-paused" style={{ color: "var(--warn)" }}>
            Paused
          </p>
        )}
        {settingsError && (
          <p className="small mt-1" role="alert" style={{ color: "var(--warn)" }}>
            {settingsError}
          </p>
        )}
        {saved === "settings" && !settingsError && (
          <p className="small mt-1" role="status" style={{ color: "var(--accent)" }}>
            Saved. It applies from the next time it matters, never to a night already under way.
          </p>
        )}
        {isOwnerOrAdmin ? (
          <>
            <form action={updateClubSettings.bind(null, clubId)} className="stack gap14 mt14" style={{ maxWidth: 420 }}>
              <label className="small muted">
                Films each picker nominates
                <div className="search mt-1">
                  <input
                    type="number"
                    name="nomineesPerTurn"
                    min={1}
                    max={5}
                    step={1}
                    required
                    defaultValue={nomineesPerTurn}
                  />
                </div>
              </label>
              <label className="small muted">
                When to ask &ldquo;Did you watch it?&rdquo;
                <select
                  name="confirmAt"
                  defaultValue={confirmAt}
                  className="sel mt-1"
                  style={{ display: "block", width: "100%" }}
                >
                  {(Object.keys(CONFIRM_AT_LABELS) as ConfirmAt[]).map((value) => (
                    <option key={value} value={value}>
                      {CONFIRM_AT_LABELS[value]}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="btn" style={{ width: "auto" }}>
                Save
              </button>
            </form>
            <form action={setClubPaused.bind(null, clubId, !club.pausedAt)} className="mt14">
              <button type="submit" className="btn ghost" style={{ width: "auto" }}>
                {club.pausedAt ? "Resume the club" : "Pause the club"}
              </button>
            </form>
            <p className="tiny dim" style={{ margin: "8px 0 0" }}>
              {club.pausedAt
                ? "Resuming schedules the next night as usual."
                : "Pausing stops new nights being scheduled. A night already under way carries on."}
            </p>
          </>
        ) : (
          <dl className="small mt14 club-settings-values" style={{ margin: "14px 0 0" }}>
            <dt className="muted">Films each picker nominates</dt>
            <dd style={{ margin: "2px 0 10px" }}>{nomineesPerTurn}</dd>
            <dt className="muted">When to ask &ldquo;Did you watch it?&rdquo;</dt>
            <dd style={{ margin: "2px 0 0" }}>{CONFIRM_AT_LABELS[confirmAt]}</dd>
          </dl>
        )}
      </section>
    </GlobalShell>
  );
}
