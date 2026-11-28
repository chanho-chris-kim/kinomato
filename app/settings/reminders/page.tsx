import { requireUser } from "@/app/auth";
import { setClubRemindersMuted, setEmailReminders } from "../actions";
import { reminderClubsFor, SettingsFrame } from "../settingsFrame";

// Reminders (u7; ruled 2026-11-23, §5.9): the main switch, then a switch
// per club (on = not muted). Each switch is a submit button with
// role="switch", so it works without script. While the main switch is off
// the club switches are disabled: nothing goes to any club then. Sign-in
// codes and account notices never look at these.
export default async function RemindersPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const { saved } = await searchParams;
  const user = await requireUser("/settings/reminders");
  const clubs = await reminderClubsFor(user.id);
  const on = user.emailReminders;

  return (
    <SettingsFrame user={user} current="reminders">
      <h1 className="h-display page-title">Reminders</h1>
      <p className="small muted mt-1">At most two a week across all your clubs, plus one when it&apos;s your turn to pick.</p>
      {saved === "reminders" && (
        <p className="small mt14 saved-note" role="status">
          Saved.
        </p>
      )}

      <form action={setEmailReminders.bind(null, !on)} className="card now mt14 main-reminders">
        <button type="submit" role="switch" aria-checked={on} className="consent-choice switch-button switch-row">
          <span className="grow">
            <span className="block">Reminder emails</span>
            <span className="tiny dim block">Your turn, voting closing, movie night, did you watch it</span>
          </span>
          <span className="switch-track" aria-hidden="true" />
        </button>
      </form>

      {clubs.length > 0 && (
        <section className="card mt14" aria-labelledby="from-each-club">
          <h2 id="from-each-club" className="sec flush">
            From each club
          </h2>
          <ul className="plain-list mt-1 club-reminders">
            {clubs.map((c) => (
              <li key={c.clubId}>
                <form action={setClubRemindersMuted.bind(null, c.clubId, !c.muted)}>
                  <button
                    type="submit"
                    role="switch"
                    aria-checked={!c.muted}
                    disabled={!on}
                    aria-label={`Reminders from ${c.clubName}`}
                    className="consent-choice switch-button switch-row"
                  >
                    <span className="grow">
                      <span className="block club-reminder-name">
                        {c.clubName}
                        {c.muted && <span className="dim"> · muted</span>}
                      </span>
                      {!on && <span className="tiny dim block">Turned off for all clubs</span>}
                    </span>
                    <span className="switch-track" aria-hidden="true" />
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="tiny dim mt14">Sign-in codes and account notices always arrive.</p>
    </SettingsFrame>
  );
}
