// Pure. No DB calls.
//
// display_name stays the one stored column (CLAUDE.md: "not eight
// nullable fields," same reasoning as clubs.settings) — composed from
// two required fields, first name and last initial, rather than stored
// separately. Mandatory, not a form nicety: the join page lets someone
// claim a name the owner pre-added, and if the owner wrote "Priya S."
// while Priya typed just "Priya," she'd create a second membership
// instead of claiming her own. Both entry points call this, so the
// same (first name, last initial) pair always composes to the exact
// same string — that's what makes "claim an existing name" actually
// work, not a coincidence of matching free-text input.

export function composeDisplayName(firstName: string, lastInitial: string): string {
  return `${firstName} ${lastInitial}.`;
}

export type MemberNameResult = { displayName: string } | { error: string };

export function validateMemberName(firstNameRaw: string, lastInitialRaw: string): MemberNameResult {
  const firstName = firstNameRaw.trim();
  if (!firstName) {
    return { error: "First name is required." };
  }

  // Normalized to uppercase — "k" and "K" must compose to the same
  // display name, or the same duplicate-membership hole this exists to
  // close reopens on capitalization alone.
  const lastInitial = lastInitialRaw.trim().toUpperCase();
  if (!/^[A-Z]$/.test(lastInitial)) {
    return { error: "Last initial must be exactly one letter." };
  }

  return { displayName: composeDisplayName(firstName, lastInitial) };
}
