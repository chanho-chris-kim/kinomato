import { MAX_PRE_ADDED_MEMBERS } from "@/lib/clubMembers";
import { createClub } from "./actions";

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// A handful of common zones as typing suggestions — not the full ~400
// Intl.supportedValuesOf("timeZone") list, which is too many to be a
// useful <datalist>. The field still accepts (and the action still
// validates) any real IANA zone, typed or picked.
const COMMON_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Vancouver",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Kolkata",
  "Australia/Sydney",
];

export default async function NewClubPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="p-4" style={{ maxWidth: 480, margin: "0 auto" }}>
      <h1 className="h-display" style={{ fontSize: 26 }}>
        Start a club
      </h1>
      <p className="small muted mt-1">
        No account needed — you&apos;ll be in as soon as you submit this.
      </p>
      {error && (
        <p className="small mt14" style={{ color: "var(--warn)" }}>
          {error}
        </p>
      )}

      <form action={createClub} className="stack gap14 mt20">
        <div>
          <label className="small muted">
            Club name
            <div className="search mt-1">
              <input type="text" name="name" required />
            </div>
          </label>
        </div>

        <div className="card">
          <span className="small">Your name</span>
          <p className="tiny dim mt-1">This is what the rest of the club sees you as.</p>
          <div className="row gap10 mt14">
            <label className="small muted" style={{ flex: 1 }}>
              First name
              <div className="search mt-1">
                <input type="text" name="yourFirstName" required />
              </div>
            </label>
            <label className="small muted" style={{ width: 72 }}>
              Last initial
              <div className="search mt-1">
                <input type="text" name="yourLastInitial" required maxLength={1} size={2} />
              </div>
            </label>
          </div>
        </div>

        <div>
          <label className="small muted">
            Cadence
            <select name="cadence" defaultValue="weekly" className="sel mt-1" style={{ display: "block", width: "100%" }}>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
              <option value="monthly">Monthly</option>
              <option value="ad_hoc">Ad hoc</option>
            </select>
          </label>
        </div>

        <div>
          <label className="small muted">
            Day
            <select
              name="defaultDay"
              defaultValue="6"
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
        </div>

        <div>
          <label className="small muted">
            Time
            <div className="search mt-1">
              <input type="time" name="defaultTime" defaultValue="20:00" required />
            </div>
          </label>
        </div>

        <div>
          <label className="small muted">
            Timezone
            <div className="search mt-1">
              <input
                type="text"
                name="timezone"
                list="timezone-options"
                placeholder="America/New_York"
                required
              />
            </div>
            <datalist id="timezone-options">
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          </label>
        </div>

        <div>
          <span className="small muted">Mode</span>
          <div className="row gap14 mt-1">
            <label className="small">
              <input type="radio" name="mode" value="in_person" defaultChecked /> In person
            </label>
            <label className="small">
              <input type="radio" name="mode" value="remote" /> Remote
            </label>
          </div>
        </div>

        <div className="card">
          <span className="small">Add people now (optional)</span>
          <p className="tiny dim mt-1">
            So the invite lands on a club that already looks populated, not empty.
          </p>
          <div className="stack gap8 mt14">
            {Array.from({ length: MAX_PRE_ADDED_MEMBERS }, (_, i) => (
              <div key={i} className="row gap10">
                <label className="small muted" style={{ flex: 1 }}>
                  First name
                  <div className="search mt-1">
                    <input type="text" name={`memberFirstName${i}`} />
                  </div>
                </label>
                <label className="small muted" style={{ width: 72 }}>
                  Last initial
                  <div className="search mt-1">
                    <input type="text" name={`memberLastInitial${i}`} maxLength={1} size={2} />
                  </div>
                </label>
              </div>
            ))}
          </div>
        </div>

        <button type="submit" className="btn primary">
          Create club
        </button>
      </form>
    </main>
  );
}
