import { requireNamedUser } from "@/app/auth";
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
  // Signed in with a name, or /login then /welcome first
  // (docs/onboarding-spec.md §5.1).
  await requireNamedUser("/new");

  return (
    <main className="p-4" style={{ maxWidth: 480, margin: "0 auto" }}>
      <h1 className="h-display" style={{ fontSize: 26 }}>
        Start a club
      </h1>
      <p className="small muted mt-1">
        Four questions. You&apos;ll add people from the club page, each with their own link.
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

        <button type="submit" className="btn primary">
          Create club
        </button>
      </form>
    </main>
  );
}
