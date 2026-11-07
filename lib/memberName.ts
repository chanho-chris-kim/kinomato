// Pure. No DB calls.
//
// A person's name, as every club sees it: first name + last initial
// ("Chris K."), composed into the one stored column, users.display_name
// (CLAUDE.md: one column, not several nullable fields). It lives on the
// account, so it's the same in every club. Entered in three places, all
// validated here: the name step (/welcome), Settings, and an owner adding
// someone to invite (where it's only a greeting; the person sets their own).
// The initial is uppercased so "k" and "K" can't read as two people.

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
