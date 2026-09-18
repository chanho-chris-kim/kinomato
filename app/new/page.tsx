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
    <main className="p-4">
      <h1 className="text-xl font-bold">Start a club</h1>
      <p className="mt-1">
        No account needed — you&apos;ll be in as soon as you submit this.
      </p>
      {error && <p className="mt-2 text-red-700">{error}</p>}

      <form action={createClub} className="mt-4 space-y-4">
        <div>
          <label className="block">
            Club name
            <input type="text" name="name" required className="block border px-2 py-1" />
          </label>
        </div>

        <div>
          <label className="block">
            Your name
            <input type="text" name="yourName" required className="block border px-2 py-1" />
          </label>
        </div>

        <div>
          <label className="block">
            Cadence
            <select name="cadence" defaultValue="weekly" className="block border px-2 py-1">
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
              <option value="monthly">Monthly</option>
              <option value="ad_hoc">Ad hoc</option>
            </select>
          </label>
        </div>

        <div>
          <label className="block">
            Day
            <select name="defaultDay" defaultValue="6" className="block border px-2 py-1">
              {DAY_LABELS.map((label, value) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div>
          <label className="block">
            Time
            <input
              type="time"
              name="defaultTime"
              defaultValue="20:00"
              required
              className="block border px-2 py-1"
            />
          </label>
        </div>

        <div>
          <label className="block">
            Timezone
            <input
              type="text"
              name="timezone"
              list="timezone-options"
              placeholder="America/New_York"
              required
              className="block border px-2 py-1"
            />
            <datalist id="timezone-options">
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          </label>
        </div>

        <div>
          <span>Mode</span>
          <div className="flex gap-4">
            <label>
              <input type="radio" name="mode" value="in_person" defaultChecked /> In person
            </label>
            <label>
              <input type="radio" name="mode" value="remote" /> Remote
            </label>
          </div>
        </div>

        <div>
          <label className="block">
            Add people now (optional, one name per line)
            <textarea name="memberNames" rows={4} className="block border px-2 py-1" />
          </label>
        </div>

        <button type="submit" className="border px-3 py-1">
          Create club
        </button>
      </form>
    </main>
  );
}
