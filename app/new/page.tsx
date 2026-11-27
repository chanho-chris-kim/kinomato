import { requireNamedUser } from "@/app/auth";
import { GlobalShell } from "@/app/shell";
import { StepBar } from "@/app/stepBar";
import { readFormEcho } from "@/app/formEcho";
import { signupOpen } from "@/app/signIn";
import { createClub } from "./actions";
import {
  CADENCE_OPTIONS,
  COMMON_TIMEZONES,
  CONFIRM_AT_LABELS,
  DAY_LABELS,
  hoursLabel,
} from "@/app/clubFormOptions";
import { AUTO_ADVANCE_HOURS, LOCK_TIME_HOURS } from "@/lib/clubSettings";
import type { ConfirmAt } from "@/lib/confirmTiming";
import { NEW_CLUB_DEFAULTS } from "@/lib/newClub";
import { START_CLUB_PATH, START_CLUB_STEPS } from "@/lib/steps";

// "Start your club" (docs/onboarding-spec.md §5.8; redesigned u4, §5.13):
// every setting shown and prefilled with today's defaults, read by the same
// readers as the Members tab (lib/newClub.ts), so the two never disagree.
// Signed-in people reach it from Clubs, with no bar; "Start a club" with
// sign-up open arrives here as /new?start=1, the last step of its bar. A
// mistake comes back with what was typed, through the form-echo cookie.
export default async function NewClubPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; start?: string }>;
}) {
  const { error, start } = await searchParams;
  // Signed in with a name, or /login then /welcome first
  // (docs/onboarding-spec.md §5.1).
  await requireNamedUser(start ? START_CLUB_PATH : "/new");
  const echo = error ? await readFormEcho() : {};
  const value = (key: string, fallback: string | number) => echo[key] ?? String(fallback);
  const d = NEW_CLUB_DEFAULTS;
  const showVoteCounts = error ? echo.showVoteCounts === "on" : d.showVoteCounts;

  return (
    <GlobalShell current="clubs">
      <div className="signin-main">
        {start && signupOpen() && <StepBar steps={START_CLUB_STEPS} current={3} label="Starting a club" className="signup-steps" />}
        <h1 className="h-display stage-title mt14">Start your club</h1>
        <p className="small muted mt-1">We&apos;ve filled in sensible defaults. Change anything you like.</p>
        {error && (
          <p className="small mt14 warn" role="alert">
            {error}
          </p>
        )}

        <form action={createClub} className="stack gap14 mt20 club-details-form">
          {start && <input type="hidden" name="start" value="1" />}
          <label className="small muted">
            Club name
            <div className="search mt-1">
              <input type="text" name="name" required maxLength={60} defaultValue={value("name", "")} />
            </div>
          </label>

          <div className="row gap8 day-time">
            <label className="small muted grow">
              Usually on
              <select name="defaultDay" defaultValue={value("defaultDay", d.defaultDay)} className="sel mt-1 full">
                {DAY_LABELS.map((label, day) => (
                  <option key={day} value={day}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="small muted grow">
              At
              <div className="search mt-1">
                <input type="time" name="defaultTime" required defaultValue={value("defaultTime", d.defaultTime)} />
              </div>
            </label>
          </div>

          <fieldset className="consent-age age-options">
            <legend className="small muted">In person or remote?</legend>
            {(
              [
                ["in_person", "In person"],
                ["remote", "Remote"],
              ] as const
            ).map(([mode, label]) => (
              <label key={mode} className="consent-choice age-option">
                <input type="radio" name="mode" value={mode} defaultChecked={value("mode", d.mode) === mode} />
                {label}
              </label>
            ))}
          </fieldset>

          <section className="card stack gap14 runs-card" aria-labelledby="runs-heading">
            <div>
              <h2 id="runs-heading" className="sec flush">
                How your club runs
              </h2>
              <p className="tiny dim flush">Defaults most clubs keep. You can change them later in Members too.</p>
            </div>
            <label className="small muted">
              How often
              <select name="cadence" defaultValue={value("cadence", d.cadence)} className="sel mt-1 full">
                {CADENCE_OPTIONS.map(([cadence, label]) => (
                  <option key={cadence} value={cadence}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="small muted first-night">
              First night on
              <div className="search mt-1">
                <input type="date" name="firstNightOn" defaultValue={value("firstNightOn", "")} />
              </div>
            </label>
            <label className="small muted">
              Films each picker offers
              <div className="search mt-1">
                <input
                  type="number"
                  name="nomineesPerTurn"
                  min={1}
                  max={5}
                  step={1}
                  required
                  defaultValue={value("nomineesPerTurn", d.nomineesPerTurn)}
                />
              </div>
            </label>
            <label className="small muted">
              Voting closes … before the night
              <select name="lockTime" defaultValue={value("lockTime", d.lockTime)} className="sel mt-1 full">
                {LOCK_TIME_HOURS.map((hours) => (
                  <option key={hours} value={hours}>
                    {hoursLabel(hours)}
                  </option>
                ))}
              </select>
            </label>
            <label className="consent-choice small vote-counts-choice">
              <input type="checkbox" name="showVoteCounts" role="switch" defaultChecked={showVoteCounts} />
              Show vote counts while voting is open
            </label>
            <label className="small muted">
              Ask &ldquo;Did you watch it?&rdquo;
              <select name="confirmAt" defaultValue={value("confirmAt", d.confirmAt)} className="sel mt-1 full">
                {(Object.keys(CONFIRM_AT_LABELS) as ConfirmAt[]).map((confirmAt) => (
                  <option key={confirmAt} value={confirmAt}>
                    {CONFIRM_AT_LABELS[confirmAt]}
                  </option>
                ))}
              </select>
            </label>
            <label className="small muted">
              If nobody answers, log it as unconfirmed after …
              <select name="autoAdvance" defaultValue={value("autoAdvance", d.autoAdvance)} className="sel mt-1 full">
                {AUTO_ADVANCE_HOURS.map((hours) => (
                  <option key={hours} value={hours}>
                    {hoursLabel(hours)}
                  </option>
                ))}
              </select>
            </label>
            <label className="small muted">
              Timezone
              <div className="search mt-1">
                <input
                  type="text"
                  name="timezone"
                  list="timezone-options"
                  placeholder="America/New_York"
                  required
                  defaultValue={value("timezone", "")}
                />
              </div>
              <datalist id="timezone-options">
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz} />
                ))}
              </datalist>
            </label>
          </section>

          <button type="submit" className="btn primary">
            Create club
          </button>
        </form>
      </div>
    </GlobalShell>
  );
}
