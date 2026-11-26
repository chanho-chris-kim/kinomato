// Display name (ruled 2026-11-25, built u2): one free-text name per person,
// the same in every club. Pure: validation, the comparison key, the clash
// rule and how a name is shown. The database side (who's in which club)
// is app/displayNameClash.ts.

export const DISPLAY_NAME_MAX = 30;

// The names the app itself gives: someone who deleted their account
// (app/anonymise.ts) and an account before the name step.
export const FORMER_MEMBER = "Former member";
export const UNNAMED_MEMBER = "Unnamed member";

export type DisplayNameResult = { displayName: string } | { error: string };

// Trimmed, runs of whitespace made one space, 1–30 characters as people
// see them (code points, so an emoji is one). No control characters, and
// not one of the app's own names.
export function validateDisplayName(raw: string): DisplayNameResult {
  const displayName = raw.trim().replace(/\s+/g, " ");
  if (!displayName) return { error: "Enter a display name." };
  if (/\p{Cc}/u.test(displayName)) return { error: "That display name has characters we can't show." };
  if ([...displayName].length > DISPLAY_NAME_MAX) {
    return { error: `Keep your display name to ${DISPLAY_NAME_MAX} characters or fewer.` };
  }
  if ([FORMER_MEMBER, UNNAMED_MEMBER].some((reserved) => nameKey(reserved) === nameKey(displayName))) {
    return { error: "That name is reserved. Pick another." };
  }
  return { displayName };
}

// The name an owner or admin types for an invite: a greeting only, so not
// checked against anyone's display name.
export function validateInviteeName(raw: string): { name: string } | { error: string } {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) return { error: "Enter their name." };
  if (/\p{Cc}/u.test(name)) return { error: "That name has characters we can't show." };
  if ([...name].length > DISPLAY_NAME_MAX) return { error: `Keep their name to ${DISPLAY_NAME_MAX} characters or fewer.` };
  return { name };
}

// What two names are compared by: compatibility forms folded (NFKC),
// case-folded, trimmed, one space between words.
export function nameKey(name: string): string {
  return name.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
}

// The first club, in the order given, whose other active members already
// include someone going by this name. The caller passes only *other*
// active members (never the person themself, never anyone who has left).
// A member with no name yet blocks nobody.
export function findClash(
  name: string,
  clubs: { clubName: string; names: (string | null)[] }[],
): string | null {
  const key = nameKey(name);
  return clubs.find((c) => c.names.some((n) => n !== null && nameKey(n) === key))?.clubName ?? null;
}

export function clashMessage(clubName: string, name: string): string {
  return `Someone in ${clubName} already goes by ${name}${/[.!?]$/.test(name) ? "" : "."} Pick another.`;
}

// How a person's name shows anywhere: their display name, else "Unnamed
// member" until they've been through the name step.
export function shownName(displayName: string | null | undefined): string {
  return displayName ?? UNNAMED_MEMBER;
}
