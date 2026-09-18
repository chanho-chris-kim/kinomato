// A night is confirmable (and ratable) once it has a winner and hasn't
// resolved yet. Only "locked" reaches this in practice today — there's
// no lock UI yet (CLAUDE.md Build order step 3 sequences confirmation
// before it), so nights.winning_film_id is only ever set by db/seed.ts
// directly, the same way the pre-existing "watched Thief" night is. An
// "open" night past its scheduled time with no winner set genuinely
// can't be confirmed yet — that's a real gap, not something to paper
// over by guessing at a tally.
export const NON_TERMINAL_STATES = ["draft", "open", "locked"] as const;
