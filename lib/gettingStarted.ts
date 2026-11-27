// "Get {club} going" (u4, §5.13): the owner's checklist on Tonight for a club
// started since u4. Its state lives in clubs.settings.gettingStarted,
// written when the club is created; a club from before u4 has none, and no
// list. Pure.

export interface GettingStartedState {
  // "Check how the club runs": Looks good pressed, or a setting saved.
  checked: boolean;
  // "Hide this list".
  hidden: boolean;
}

export const NEW_GETTING_STARTED: GettingStartedState = { checked: false, hidden: false };

// Null when absent. Anything else malformed is configuration we don't
// understand, our bug: it fails loud (CLAUDE.md missing-data policy).
export function readGettingStarted(settings: unknown): GettingStartedState | null {
  if (typeof settings !== "object" || settings === null) return null;
  if (!("gettingStarted" in settings)) return null;
  const value = (settings as Record<string, unknown>).gettingStarted;
  const keys = typeof value === "object" && value !== null ? Object.keys(value).sort() : [];
  const state = value as Record<string, unknown>;
  if (
    keys.join(",") !== "checked,hidden" ||
    typeof state.checked !== "boolean" ||
    typeof state.hidden !== "boolean"
  ) {
    throw new Error(`Unrecognized clubs.settings.gettingStarted: ${JSON.stringify(value)}.`);
  }
  return { checked: state.checked, hidden: state.hidden };
}

export type GettingStartedKey = "create" | "invite" | "films" | "check";

export const FILMS_TO_ADD = 3;

export function gettingStartedItems(input: {
  // Another active member, or a pending invite.
  hasOtherPeople: boolean;
  // Films on the owner's own watchlist.
  ownFilms: number;
  checked: boolean;
}): { key: GettingStartedKey; done: boolean }[] {
  return [
    { key: "create", done: true },
    { key: "invite", done: input.hasOtherPeople },
    { key: "films", done: input.ownFilms >= FILMS_TO_ADD },
    { key: "check", done: input.checked },
  ];
}

export function showGettingStarted(input: {
  state: GettingStartedState | null;
  isOwner: boolean;
  items: { done: boolean }[];
}): boolean {
  return Boolean(input.state && !input.state.hidden && input.isOwner && input.items.some((i) => !i.done));
}

// "Your first night: Saturday, Nov 28 at 8:00pm": the day in words and the
// app's one time format (formatNightTime's), in the club's timezone.
export function firstNightWords(at: Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${part("weekday")}, ${part("month")} ${part("day")}`,
    time: `${part("hour")}:${part("minute")}${part("dayPeriod").toLowerCase()}`,
  };
}
