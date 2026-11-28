// Pure formatting helpers. No DB calls.

// "12 films · 21h 40m" (watchlist-spec.md §2.4) — the exact header shape
// that made total runtime worth showing at all.
export function formatRuntime(totalMinutes: number): string {
  const minutes = Math.floor(totalMinutes);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (hours === 0) return `${remainder}m`;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// "20:00" / "20:30:00" (Postgres's time format) -> "8:00pm" / "8:30pm":
// the one time format the app uses (lib/clubStatus.ts formatNightTime).
function spokenTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")}${suffix}`;
}

// The club header's schedule line (docs/onboarding-spec.md §5.10), e.g.
// "Weekly, Saturdays at 8:00pm · In person". Only what the club has set;
// a missing day or time is left out, never invented. "Monthly" is the Nth
// weekday of the month (lib/schedule.ts), so the line names the weekday
// without claiming which one.
export function describeSchedule(club: {
  cadence: "weekly" | "biweekly" | "monthly" | "ad_hoc";
  defaultDay: number | null;
  defaultTime: string | null;
  mode: "in_person" | "remote";
}): string {
  const day = club.defaultDay === null ? null : WEEKDAYS[club.defaultDay];
  const at = club.defaultTime ? ` at ${spokenTime(club.defaultTime)}` : "";
  const where = club.mode === "remote" ? "Remote" : "In person";

  let when: string;
  switch (club.cadence) {
    case "ad_hoc":
      when = "No fixed night";
      break;
    case "weekly":
      when = day ? `Weekly, ${day}s${at}` : `Weekly${at}`;
      break;
    case "biweekly":
      when = day ? `Every other ${day}${at}` : `Every other week${at}`;
      break;
    case "monthly":
      when = day ? `Monthly, on a ${day}${at}` : `Monthly${at}`;
      break;
  }
  return `${when} · ${where}`;
}

// "5 minutes ago", "1 day ago", "3 weeks ago" — for a pending invite's age
// on the Members tab. Coarse on purpose: nobody needs the exact minute.
export function timeAgo(then: Date, now: Date): string {
  const seconds = Math.max(0, (now.getTime() - then.getTime()) / 1000);
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"} ago`;
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return unit(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return unit(hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 14) return unit(days, "day");
  return unit(Math.floor(days / 7), "week");
}

// The Members page's "How this club runs" row (u6): "Weekly · Sat 8:00pm ·
// 3 films". The same one time format; a missing day or time left out.
export function runsSummary(
  club: { cadence: "weekly" | "biweekly" | "monthly" | "ad_hoc"; defaultDay: number | null; defaultTime: string | null },
  nomineesPerTurn: number,
): string {
  const often = { weekly: "Weekly", biweekly: "Every other week", monthly: "Monthly", ad_hoc: "No fixed night" }[club.cadence];
  const when =
    club.cadence === "ad_hoc"
      ? ""
      : [club.defaultDay === null ? "" : WEEKDAYS[club.defaultDay].slice(0, 3), club.defaultTime ? spokenTime(club.defaultTime) : ""]
          .filter(Boolean)
          .join(" ");
  const films = `${nomineesPerTurn} ${nomineesPerTurn === 1 ? "film" : "films"}`;
  return [often, when, films].filter(Boolean).join(" · ");
}

// "Nov 7", in the club's time zone: "joined Nov 7" on a person's page.
export function monthDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(at);
}
