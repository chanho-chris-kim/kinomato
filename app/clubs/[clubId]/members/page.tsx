import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { clubs, constraints, invites } from "@/db/schema";
import { requireClubMember } from "@/app/auth";
import { getBaseUrl } from "@/app/baseUrl";
import { ClubHeader, ClubTabs, GlobalShell } from "@/app/shell";
import { FREE_TIER_MEMBER_CAP } from "@/lib/clubMembers";
import { timeAgo } from "@/lib/format";
import { canCreateInvite } from "@/lib/invites";
import { getConfirmAt, getNomineesPerTurn } from "@/lib/clubSettings";
import type { ConfirmAt } from "@/lib/confirmTiming";
import {
  addLimit,
  createInvite,
  deleteClubAsLastMember,
  leaveClub,
  makeAdmin,
  regenerateInvite,
  removeAdmin,
  removeLimit,
  removeMember,
  revokeInvite,
  setClubPaused,
  setLimitsApplyWhenAbsent,
  transferOwnership,
  updateClubDetails,
  updateClubSettings,
} from "../actions";
import { COMMON_TIMEZONES, DAY_LABELS } from "@/app/clubFormOptions";
import { readFormEcho } from "@/app/formEcho";
import Link from "next/link";
import { canChangeRole, canRemove, canTransferOwnership, type RoleMember } from "@/lib/roles";
import { planLeave } from "@/lib/clubLeave";
import { describeLimit, MAX_RUNTIME_LIMIT, MIN_RUNTIME_LIMIT, MOVIE_GENRES } from "@/lib/constraintForm";
import { canAddHardLimit } from "@/lib/constraints";
import { nameOf, type ClubMembership } from "../members";
import { describeSchedule } from "@/lib/format";
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
// and admins change it), Leave this club. Not yet built: your limits in
// this club. No rail here: it would repeat the main column. Its space is
// kept (reserveRail).
export default async function MembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ clubId: string }>;
  searchParams: Promise<{
    invite?: string;
    inviteError?: string;
    settingsError?: string;
    detailsError?: string;
    saved?: string;
    transfer?: string;
    roles?: string;
    rolesError?: string;
    remove?: string;
    removed?: string;
    leave?: string;
    leaveError?: string;
    limits?: string;
    limitsError?: string;
  }>;
}) {
  const { clubId } = await params;
  const {
    invite: newInviteId,
    inviteError,
    settingsError,
    detailsError,
    saved,
    transfer,
    roles,
    rolesError,
    remove,
    removed,
    leave,
    leaveError,
    limits,
    limitsError,
  } = await searchParams;
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
  // The viewer's own limits, and only theirs (ruled 2026-11-12): nobody else
  // sees them, so nothing here loads anyone else's.
  const myLimits = await db
    .select()
    .from(constraints)
    .where(eq(constraints.membershipId, me.id))
    .orderBy(asc(constraints.kind), asc(constraints.ruleType), asc(constraints.value));
  const limitsApplyWhenAbsent = myLimits.some((c) => c.appliesWhenAbsent);
  const atHardCap = !canAddHardLimit(myLimits);

  // Roles (ruled 2026-11-11): only the owner gets controls, and only where
  // lib/roles.ts allows; the actions check again.
  const asRoleMember = (m: Pick<ClubMembership, "id" | "clubId" | "role" | "leftAt">): RoleMember => ({
    membershipId: m.id,
    clubId: m.clubId,
    role: m.role,
    leftAt: m.leftAt,
  });
  const meForRoles = asRoleMember(me);
  // Per-member controls: the owner's role controls (m4), and Remove for
  // whoever lib/roles.ts canRemove allows (owner: anyone but themself;
  // admin: plain members). Nobody else gets any.
  const memberControls =
    me.role === "owner" || me.role === "admin"
      ? (m: ClubMembership) => {
          const target = asRoleMember(m);
          const name = nameOf(m);
          const items = [];
          if (canChangeRole(meForRoles, target, "admin")) {
            items.push(
              <form key="admin" action={makeAdmin.bind(null, clubId, m.id)}>
                <button type="submit" className="btn ghost" style={{ width: "auto" }} aria-label={`Make ${name} an admin`}>
                  Make admin
                </button>
              </form>,
            );
          }
          if (canChangeRole(meForRoles, target, "member")) {
            items.push(
              <form key="unadmin" action={removeAdmin.bind(null, clubId, m.id)}>
                <button type="submit" className="btn ghost" style={{ width: "auto" }} aria-label={`Remove ${name} as admin`}>
                  Remove admin
                </button>
              </form>,
            );
          }
          if (canTransferOwnership(meForRoles, target)) {
            items.push(
              <Link
                key="owner"
                href={`/clubs/${clubId}/members?transfer=${m.id}#roles`}
                className="btn ghost"
                style={{ width: "auto" }}
                aria-label={`Make ${name} the owner`}
              >
                Make owner
              </Link>,
            );
          }
          if (canRemove(meForRoles, target)) {
            items.push(
              <Link
                key="remove"
                href={`/clubs/${clubId}/members?remove=${m.id}#roles`}
                className="btn ghost"
                style={{ width: "auto" }}
                aria-label={`Remove ${name} from the club`}
              >
                Remove
              </Link>,
            );
          }
          return items.length ? items : null;
        }
      : undefined;
  const removeCandidate = remove ? activeMemberships.find((m) => m.id === remove) : undefined;
  const removeTarget =
    removeCandidate && canRemove(meForRoles, asRoleMember(removeCandidate)) ? removeCandidate : null;

  // Leaving (ruled 2026-11-11): the plan decides what the confirm offers.
  const others = activeMemberships.filter((m) => m.id !== me.id);
  const leavePlan = planLeave(
    me.role,
    others.map((o) => ({ membershipId: o.id, role: o.role, joinedAt: o.joinedAt })),
  );
  const heir = leavePlan.kind === "transfer" ? others.find((o) => o.id === leavePlan.heirMembershipId) : undefined;
  const transferCandidate = transfer ? activeMemberships.find((m) => m.id === transfer) : undefined;
  const transferTarget =
    transferCandidate && canTransferOwnership(meForRoles, asRoleMember(transferCandidate)) ? transferCandidate : null;
  const nomineesPerTurn = getNomineesPerTurn(club.settings);
  const confirmAt = getConfirmAt(club.settings);
  // After a mistake, the details form shows what was typed (form-echo
  // cookie, never the URL); otherwise the club's current values.
  const echo = detailsError ? await readFormEcho() : {};
  const details = {
    name: echo.name ?? club.name,
    cadence: echo.cadence ?? club.cadence,
    defaultDay: echo.defaultDay ?? String(club.defaultDay ?? 6),
    defaultTime: echo.defaultTime ?? (club.defaultTime ?? "20:00").slice(0, 5),
    timezone: echo.timezone ?? club.timezone,
    mode: echo.mode ?? club.mode,
    firstNightOn: echo.firstNightOn ?? "",
  };

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
      <h2 id="roles" className="sec mt14">
        Members
      </h2>
      {rolesError && (
        <p className="small mt-1" role="alert" style={{ color: "var(--warn)" }}>
          {rolesError}
        </p>
      )}
      {roles && !rolesError && (
        <p className="small mt-1" role="status" style={{ color: "var(--accent)" }}>
          {roles === "transferred" ? "Done. You're an admin now." : "Saved."}
        </p>
      )}
      {transferTarget && (
        // The two-tap transfer's confirm (ruled 2026-11-11). The second
        // POST carries the membership id, never a name.
        <div className="card mt14 transfer-confirm" style={{ borderColor: "var(--accent)" }}>
          <p className="small" style={{ margin: 0 }}>
            Make {nameOf(transferTarget)} the owner of {club.name}? You&apos;ll become an admin.
          </p>
          <div className="row gap8 mt14">
            <form action={transferOwnership.bind(null, clubId, transferTarget.id)}>
              <button type="submit" className="btn primary" style={{ width: "auto" }}>
                Make owner
              </button>
            </form>
            <Link href={`/clubs/${clubId}/members`} className="btn ghost" style={{ width: "auto" }}>
              Cancel
            </Link>
          </div>
        </div>
      )}
      {removed && (
        <p className="small mt-1" role="status" style={{ color: "var(--accent)" }}>
          Removed.
        </p>
      )}
      {removeTarget && (
        // Two-tap removal (ruled 2026-11-11); the POST carries the
        // membership id, never a name.
        <div className="card mt14 remove-confirm" style={{ borderColor: "var(--warn)" }}>
          <p className="small" style={{ margin: 0 }}>
            Remove {nameOf(removeTarget)} from {club.name}? Their past picks, votes and ratings stay in its history.
          </p>
          <div className="row gap8 mt14">
            <form action={removeMember.bind(null, clubId, removeTarget.id)}>
              <button type="submit" className="btn primary" style={{ width: "auto" }}>
                Remove
              </button>
            </form>
            <Link href={`/clubs/${clubId}/members`} className="btn ghost" style={{ width: "auto" }}>
              Cancel
            </Link>
          </div>
        </div>
      )}
      <MemberCards members={activeMemberships} meId={me.id} controls={memberControls} />

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

      <section id="limits" className="mt20" aria-labelledby="limits-heading">
        {/* Your limits in this club (§5.10, ruled 2026-11-12): the viewer's
            own, seen and changed by nobody else. */}
        <h2 id="limits-heading" className="sec">
          Your limits in this club
        </h2>
        <p className="tiny dim" style={{ margin: "4px 0 0" }}>
          These apply in {club.name} only. Two hard limits each. Hard limits are never voted on. Preferences
          break ties.
        </p>
        <p className="tiny dim" style={{ margin: "4px 0 0" }}>
          A change counts from the next time films are checked: the next nomination, or the close of a vote
          that&apos;s already open.
        </p>
        {limitsError && (
          <p className="small mt-1" role="alert" style={{ color: "var(--warn)" }}>
            {limitsError}
          </p>
        )}
        {limits === "saved" && !limitsError && (
          <p className="small mt-1" role="status" style={{ color: "var(--accent)" }}>
            Saved.
          </p>
        )}
        {myLimits.length === 0 ? (
          <p className="small muted mt14">No limits set for this club.</p>
        ) : (
          <ul className="stack gap8 mt14 my-limits" style={{ listStyle: "none", margin: "14px 0 0", padding: 0 }}>
            {myLimits.map((c) => {
              const words = describeLimit(c);
              return (
                <li key={c.id} className="row gap8">
                  <span className={`chip ${c.kind === "hard" ? "on" : ""}`}>{words}</span>
                  <form action={removeLimit.bind(null, clubId, c.id)} style={{ marginLeft: "auto" }}>
                    <button type="submit" className="btn ghost" style={{ width: "auto" }} aria-label={`Remove ${words}`}>
                      Remove
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}

        <form action={addLimit.bind(null, clubId)} className="limit-form stack gap14 mt14" style={{ maxWidth: 420 }}>
          <fieldset className="consent-age">
            <legend className="small muted">Kind</legend>
            <label className="consent-choice">
              <input type="radio" name="kind" value="hard" defaultChecked={!atHardCap} disabled={atHardCap} /> Hard
              limit
            </label>
            <label className="consent-choice">
              <input type="radio" name="kind" value="soft" defaultChecked={atHardCap} /> Prefer not
            </label>
          </fieldset>
          {atHardCap && <p className="tiny dim limit-cap" style={{ margin: 0 }}>{"You have two hard limits. Remove one, or add this as a preference."}</p>}
          <fieldset className="consent-age">
            <legend className="small muted">What</legend>
            <label className="consent-choice">
              <input type="radio" name="ruleType" value="genre" defaultChecked /> A genre
            </label>
            <label className="consent-choice">
              <input type="radio" name="ruleType" value="runtime" /> A length
            </label>
          </fieldset>
          <label className="small muted limit-genre">
            Genre
            <select name="genre" className="sel mt-1" style={{ display: "block", width: "100%" }} defaultValue="">
              <option value="" disabled>
                Choose a genre
              </option>
              {MOVIE_GENRES.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
          <label className="small muted limit-minutes">
            Nothing over (minutes)
            <div className="search mt-1">
              <input type="number" name="minutes" min={MIN_RUNTIME_LIMIT} max={MAX_RUNTIME_LIMIT} step={1} />
            </div>
          </label>
          <button type="submit" className="btn" style={{ width: "auto" }}>
            Add
          </button>
        </form>

        {myLimits.length > 0 && (
          <form action={setLimitsApplyWhenAbsent.bind(null, clubId, !limitsApplyWhenAbsent)} className="mt14">
            <div className="row gap8" style={{ alignItems: "center" }}>
              <span className="small" style={{ flex: 1 }}>
                Apply my limits even on weeks I&apos;m out
              </span>
              <button
                type="submit"
                className={`btn ${limitsApplyWhenAbsent ? "primary" : "ghost"}`}
                style={{ width: "auto" }}
                role="switch"
                aria-checked={limitsApplyWhenAbsent}
                aria-label="Apply my limits even on weeks I'm out"
              >
                {limitsApplyWhenAbsent ? "On" : "Off"}
              </button>
            </div>
          </form>
        )}
      </section>

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
            <h3 id="club-details" className="small mt14" style={{ fontWeight: 600 }}>
              Club details
            </h3>
            {detailsError && (
              <p className="small mt-1 details-error" role="alert" style={{ color: "var(--warn)" }}>
                {detailsError}
              </p>
            )}
            {saved === "details" && !detailsError && (
              <p className="small mt-1" role="status" style={{ color: "var(--accent)" }}>
                Saved. It applies from the next night; a night already under way keeps its date.
              </p>
            )}
            <form
              action={updateClubDetails.bind(null, clubId)}
              className="club-details-form stack gap14 mt14"
              style={{ maxWidth: 420 }}
            >
              <label className="small muted">
                Club name
                <div className="search mt-1">
                  <input type="text" name="name" required defaultValue={details.name} />
                </div>
              </label>
              <label className="small muted">
                How often
                {/* No "no fixed schedule" here until nights can be
                    scheduled by hand (ruled 2026-11-10). A club already
                    ad hoc sees it selected only until it picks one. */}
                <select
                  name="cadence"
                  defaultValue={details.cadence === "ad_hoc" ? "weekly" : details.cadence}
                  className="sel mt-1"
                  style={{ display: "block", width: "100%" }}
                >
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Every other week</option>
                  <option value="monthly">Monthly</option>
                </select>
              </label>
              <label className="small muted">
                Day
                <select
                  name="defaultDay"
                  defaultValue={details.defaultDay}
                  className="sel mt-1"
                  style={{ display: "block", width: "100%" }}
                >
                  {DAY_LABELS.map((label, value) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="small muted">
                Time
                <div className="search mt-1">
                  <input type="time" name="defaultTime" required defaultValue={details.defaultTime} />
                </div>
              </label>
              <label className="small muted">
                Timezone
                <div className="search mt-1">
                  <input type="text" name="timezone" list="club-timezone-options" required defaultValue={details.timezone} />
                </div>
                <datalist id="club-timezone-options">
                  {COMMON_TIMEZONES.map((tz) => (
                    <option key={tz} value={tz} />
                  ))}
                </datalist>
              </label>
              <div>
                <span className="small muted">In person or remote</span>
                <div className="row gap14 mt-1">
                  <label className="small">
                    <input type="radio" name="mode" value="in_person" defaultChecked={details.mode === "in_person"} /> In
                    person
                  </label>
                  <label className="small">
                    <input type="radio" name="mode" value="remote" defaultChecked={details.mode === "remote"} /> Remote
                  </label>
                </div>
              </div>
              {/* Shown for every other week and monthly (app/globals.css);
                  required by the server only when the counting would
                  otherwise come from nowhere anyone chose
                  (lib/clubDetails.ts firstNightRequired). */}
              <div className="first-night">
                <label className="small muted">
                  First night on
                  <div className="search mt-1">
                    <input
                      type="date"
                      name="firstNightOn"
                      defaultValue={details.firstNightOn}
                      aria-describedby="first-night-hint"
                    />
                  </div>
                </label>
                <span id="first-night-hint" className="tiny dim" style={{ display: "block", marginTop: 4 }}>
                  Needed when you change how often the club meets or the day. It has to fall on that day,
                  and every other week or month counts from it.
                </span>
              </div>
              <p className="tiny dim" style={{ margin: 0 }}>
                Changes apply from the next night. A night already under way keeps its date.
              </p>
              <button type="submit" className="btn" style={{ width: "auto" }}>
                Save details
              </button>
            </form>

            <h3 className="small mt20" style={{ fontWeight: 600 }}>
              Nights
            </h3>
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
            <dt className="muted">When</dt>
            <dd style={{ margin: "2px 0 10px" }}>{describeSchedule(club)}</dd>
            <dt className="muted">Timezone</dt>
            <dd style={{ margin: "2px 0 10px" }}>{club.timezone}</dd>
            <dt className="muted">Films each picker nominates</dt>
            <dd style={{ margin: "2px 0 10px" }}>{nomineesPerTurn}</dd>
            <dt className="muted">When to ask &ldquo;Did you watch it?&rdquo;</dt>
            <dd style={{ margin: "2px 0 0" }}>{CONFIRM_AT_LABELS[confirmAt]}</dd>
          </dl>
        )}
      </section>

      <section id="leave" className="mt20" aria-labelledby="leave-heading">
        <h2 id="leave-heading" className="sec">
          Leave this club
        </h2>
        {leaveError && (
          <p className="small mt-1" role="alert" style={{ color: "var(--warn)" }}>
            {leaveError}
          </p>
        )}
        {!leave ? (
          <Link href={`/clubs/${clubId}/members?leave=1#leave`} className="btn ghost mt14" style={{ width: "auto" }}>
            Leave this club
          </Link>
        ) : leavePlan.kind === "last_member" ? (
          // The last active member can't simply leave (ruled 2026-11-11):
          // pause, or delete the club by typing its name.
          <div className="card mt14 leave-confirm">
            <p className="small" style={{ margin: 0 }}>
              You&apos;re the last member of {club.name}, so you can&apos;t just leave it. Pause it to come back
              later, or delete it.
            </p>
            {!club.pausedAt && (
              <form action={setClubPaused.bind(null, clubId, true)} className="mt14">
                <button type="submit" className="btn" style={{ width: "auto" }}>
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
              <button type="submit" className="btn primary" style={{ width: "auto" }}>
                Delete this club
              </button>
            </form>
            <Link href={`/clubs/${clubId}/members`} className="btn ghost mt14" style={{ width: "auto" }}>
              Cancel
            </Link>
          </div>
        ) : (
          <div className="card mt14 leave-confirm">
            <p className="small" style={{ margin: 0 }}>
              Leave {club.name}? Your past picks, votes and ratings stay in its history.
            </p>
            {heir && (
              <p className="small mt-1" style={{ margin: "8px 0 0" }}>
                {nameOf(heir)} will become the owner.
              </p>
            )}
            <div className="row gap8 mt14">
              <form action={leaveClub.bind(null, clubId, null)}>
                <button type="submit" className="btn primary" style={{ width: "auto" }}>
                  Leave
                </button>
              </form>
              <Link href={`/clubs/${clubId}/members`} className="btn ghost" style={{ width: "auto" }}>
                Cancel
              </Link>
            </div>
            {heir && others.length > 1 && (
              <div className="mt14 choose-heir">
                <p className="tiny dim" style={{ margin: 0 }}>
                  Choose someone else
                </p>
                <div className="stack gap8 mt-1">
                  {others
                    .filter((o) => o.id !== heir.id)
                    .map((o) => (
                      <form key={o.id} action={leaveClub.bind(null, clubId, o.id)}>
                        <button type="submit" className="btn ghost" style={{ width: "auto" }}>
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
    </GlobalShell>
  );
}
