import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { clubs } from "@/db/schema";
import { requireClubMember } from "@/app/auth";
import { COMMON_TIMEZONES, CONFIRM_AT_LABELS, DAY_LABELS, hoursLabel } from "@/app/clubFormOptions";
import { readFormEcho } from "@/app/formEcho";
import {
  AUTO_ADVANCE_HOURS,
  getAutoAdvance,
  getConfirmAt,
  getLockTime,
  getNomineesPerTurn,
  getShowVoteCounts,
  LOCK_TIME_HOURS,
} from "@/lib/clubSettings";
import type { ConfirmAt } from "@/lib/confirmTiming";
import { describeSchedule } from "@/lib/format";
import { formatJoinCode } from "@/lib/joinCode";
import { makeNewJoinCode, setJoinCodeOn, updateClubDetails, updateClubSettings } from "../../actions";
import { CopyCode } from "../../CopyCode";
import { MembersFrame, RowLink } from "../membersFrame";

// How {club} runs (u6, ruled 2026-11-27; the settings ruled 2026-11-10:
// every member sees them, owners and admins change them). Three groups
// shown as values. For owners and admins each has its own Edit, which opens
// that group alone as a form (?edit=club|voting|after, nothing personal);
// the others stay values. The same readers validate (lib/clubDetails.ts,
// lib/clubSettings.ts), and a mistake comes back with what was typed
// (form-echo cookie). Then the club code and pausing, owners and admins
// only. A plain member gets the values alone: no Edit, no code, no Pause;
// the actions refuse them anyway.
type Group = "club" | "voting" | "after";
const GROUP_NAMES: Record<Group, string> = { club: "The club", voting: "Voting", after: "After the night" };

export default async function ClubSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ clubId: string }>;
  searchParams: Promise<{ edit?: string; saved?: string; settingsError?: string; detailsError?: string; code?: string }>;
}) {
  const { clubId } = await params;
  const { edit: rawEdit, saved, settingsError, detailsError, code: codeNotice } = await searchParams;
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const { membership: me } = await requireClubMember(clubId, `/clubs/${clubId}/members/settings`);
  const canChange = me.role === "owner" || me.role === "admin";
  const [club] = await db.select().from(clubs).where(eq(clubs.id, clubId));
  const edit: Group | null =
    canChange && (rawEdit === "club" || rawEdit === "voting" || rawEdit === "after") ? rawEdit : null;
  const here = `/clubs/${clubId}/members/settings`;

  const nomineesPerTurn = getNomineesPerTurn(club.settings);
  const confirmAt = getConfirmAt(club.settings);
  const lockTime = getLockTime(club.settings);
  const autoAdvance = getAutoAdvance(club.settings);
  const showVoteCounts = getShowVoteCounts(club.settings);
  // After a mistake, the club form shows what was typed (never the URL).
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

  const savedNote = (group: Group, text: string) =>
    saved === group && (
      <p className="small mt-1 saved-note" role="status">
        {text}
      </p>
    );
  const head = (group: Group) => (
    <div className="between">
      <h2 id={`${group}-heading`} className="sec flush">
        {GROUP_NAMES[group]}
      </h2>
      {canChange && edit !== group && (
        <Link href={`${here}?edit=${group}#${group}`} className="underline tap small edit-link" aria-label={`Edit ${GROUP_NAMES[group].toLowerCase()}`}>
          Edit
        </Link>
      )}
    </div>
  );
  const actions = (
    <div className="row gap8">
      <button type="submit" className="btn auto">
        Save
      </button>
      <Link href={here} className="btn ghost auto">
        Cancel
      </Link>
    </div>
  );

  return (
    <MembersFrame db={db} club={club} role={me.role}>
      <h2 className="h-display stage-title mt14 page-title">How {club.name} runs</h2>
      <p className="small muted mt-1">Changes apply from the next night. A night already under way keeps its plan.</p>

      <section id="club" className="card mt14 settings-group" aria-labelledby="club-heading">
        {head("club")}
        {savedNote("club", "Saved. It applies from the next night; a night already under way keeps its date.")}
        {edit === "club" ? (
          <form action={updateClubDetails.bind(null, clubId)} className="club-details-form stack gap14 mt14">
            {detailsError && (
              <p className="small flush details-error warn" role="alert">
                {detailsError}
              </p>
            )}
            <label className="small muted">
              Club name
              <div className="search mt-1">
                <input type="text" name="name" required defaultValue={details.name} />
              </div>
            </label>
            <label className="small muted">
              How often
              {/* No "no fixed schedule" here until nights can be scheduled
                  by hand (ruled 2026-11-10). */}
              <select name="cadence" defaultValue={details.cadence === "ad_hoc" ? "weekly" : details.cadence} className="sel mt-1 full">
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every other week</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
            <label className="small muted">
              Day
              <select name="defaultDay" defaultValue={details.defaultDay} className="sel mt-1 full">
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
            <fieldset className="plain-fieldset">
              <legend className="small muted">In person or remote</legend>
              <div className="row gap14 mt-1">
                <label className="small choice">
                  <input type="radio" name="mode" value="in_person" defaultChecked={details.mode === "in_person"} /> In
                  person
                </label>
                <label className="small choice">
                  <input type="radio" name="mode" value="remote" defaultChecked={details.mode === "remote"} /> Remote
                </label>
              </div>
            </fieldset>
            {/* Shown for every other week and monthly (app/globals.css);
                required only when the counting would otherwise come from
                nowhere anyone chose (lib/clubDetails.ts firstNightRequired). */}
            <div className="first-night">
              <label className="small muted">
                First night on
                <div className="search mt-1">
                  <input type="date" name="firstNightOn" defaultValue={details.firstNightOn} aria-describedby="first-night-hint" />
                </div>
              </label>
              <span id="first-night-hint" className="tiny dim block mt-1">
                Needed when you change how often the club meets or the day. It has to fall on that day, and every other
                week or month counts from it.
              </span>
            </div>
            {actions}
          </form>
        ) : (
          <dl className="values mt14 club-values">
            <dt>Name</dt>
            <dd>{club.name}</dd>
            <dt>When</dt>
            <dd>{describeSchedule(club).split(" · ")[0]}</dd>
            <dt>Time zone</dt>
            <dd>{club.timezone}</dd>
            <dt>Where</dt>
            <dd>{club.mode === "remote" ? "Remote" : "In person"}</dd>
          </dl>
        )}
      </section>

      <section id="voting" className="card mt14 settings-group" aria-labelledby="voting-heading">
        {head("voting")}
        {savedNote("voting", "Saved. It applies from the next time it matters, never to a night already under way.")}
        {edit === "voting" ? (
          <form action={updateClubSettings.bind(null, clubId, "voting")} className="stack gap14 mt14 voting-form">
            {settingsError && (
              <p className="small flush warn" role="alert">
                {settingsError}
              </p>
            )}
            <label className="small muted">
              Films each picker offers
              <div className="search mt-1">
                <input type="number" name="nomineesPerTurn" min={1} max={5} step={1} required defaultValue={nomineesPerTurn} />
              </div>
            </label>
            <label className="small muted">
              Voting closes … before the night
              <select name="lockTime" defaultValue={String(lockTime)} className="sel mt-1 full">
                {LOCK_TIME_HOURS.map((hours) => (
                  <option key={hours} value={hours}>
                    {hoursLabel(hours)}
                  </option>
                ))}
              </select>
            </label>
            <label className="consent-choice small vote-counts-choice">
              <input type="checkbox" name="showVoteCounts" defaultChecked={showVoteCounts} />
              Show vote counts while voting is open
            </label>
            <p className="tiny dim deadlines-note flush">
              Everyone gets at least 6 hours to vote, and voting closes by the time the night starts. Changing these
              never moves a night already under way.
            </p>
            {actions}
          </form>
        ) : (
          <dl className="values mt14 voting-values">
            <dt>Films each picker offers</dt>
            <dd>{nomineesPerTurn}</dd>
            <dt>Voting closes</dt>
            <dd>{hoursLabel(lockTime)} before the night</dd>
            <dt>Vote counts while voting is open</dt>
            <dd>{showVoteCounts ? "Shown" : "Hidden until voting closes"}</dd>
          </dl>
        )}
      </section>

      <section id="after" className="card mt14 settings-group" aria-labelledby="after-heading">
        {head("after")}
        {savedNote("after", "Saved. It applies from the next time it matters, never to a night already under way.")}
        {edit === "after" ? (
          <form action={updateClubSettings.bind(null, clubId, "after")} className="stack gap14 mt14 after-form">
            {settingsError && (
              <p className="small flush warn" role="alert">
                {settingsError}
              </p>
            )}
            <label className="small muted">
              When to ask &ldquo;Did you watch it?&rdquo;
              <select name="confirmAt" defaultValue={confirmAt} className="sel mt-1 full">
                {(Object.keys(CONFIRM_AT_LABELS) as ConfirmAt[]).map((value) => (
                  <option key={value} value={value}>
                    {CONFIRM_AT_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="small muted">
              If nobody answers, log it as unconfirmed after …
              <select name="autoAdvance" defaultValue={String(autoAdvance)} className="sel mt-1 full">
                {AUTO_ADVANCE_HOURS.map((hours) => (
                  <option key={hours} value={hours}>
                    {hoursLabel(hours)}
                  </option>
                ))}
              </select>
            </label>
            {actions}
          </form>
        ) : (
          <dl className="values mt14 after-values">
            <dt>When to ask &ldquo;Did you watch it?&rdquo;</dt>
            <dd>{CONFIRM_AT_LABELS[confirmAt]}</dd>
            <dt>Logged as unconfirmed after</dt>
            <dd>{hoursLabel(autoAdvance)}</dd>
          </dl>
        )}
      </section>

      {/* Owners and admins only: the code and pausing. */}
      {canChange && (
        <>
        <section id="join-code" className="card mt14" aria-labelledby="join-code-heading">
          <h2 id="join-code-heading" className="sec flush">
            Club code
          </h2>
          {/* A submit button with role="switch": it works without script. */}
          <form action={setJoinCodeOn.bind(null, clubId, !club.joinCode)} className="mt-1">
            <button type="submit" role="switch" aria-checked={club.joinCode !== null} className="consent-choice small switch-button">
              <span className="switch-track" aria-hidden="true" />
              Let people ask to join with a code
            </button>
          </form>
          <p className="tiny dim flush">Anyone with the code can ask to join. Nobody gets in until you or an admin says yes.</p>
          {club.joinCode && (
            <div className="stack gap8 mt14">
              <CopyCode code={formatJoinCode(club.joinCode)} label={`Club code for ${club.name}`} />
              {codeNotice === "new" && (
                <p className="small flush saved-note" role="status">
                  New code made. The old one doesn&apos;t work any more.
                </p>
              )}
              <form action={makeNewJoinCode.bind(null, clubId)}>
                <button type="submit" className="btn ghost">
                  Make a new code (the old one stops working)
                </button>
              </form>
            </div>
          )}
        </section>

        <section className="card mt14" aria-label="Pause the club">
          {saved === "pause" && (
            <p className="small flush saved-note" role="status">
              {club.pausedAt ? "Paused. No new nights are scheduled." : "Running again. The next night is scheduled as usual."}
            </p>
          )}
          <RowLink href={`${here}/pause`} label="Pause the club" value={club.pausedAt ? "Paused" : "Running"} />
        </section>
        </>
      )}
    </MembersFrame>
  );
}
