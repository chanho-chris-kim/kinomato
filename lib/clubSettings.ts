// Pure. No DB calls.
//
// clubs.settings is one JSONB blob (CLAUDE.md Conventions: "not eight
// nullable fields") holding the admin-flexibility table from
// analysis-v2.md §2. This is the first field actually read from it —
// nominees per turn, documented range 1–5, default 3. The column is
// untyped JSONB with no runtime validation at the write boundary yet
// (nothing writes to it besides db/seed.ts's default {} today), so this
// defends against anything: missing, wrong type, out of range.

const DEFAULT_NOMINEES_PER_TURN = 3;
const MIN_NOMINEES_PER_TURN = 1;
const MAX_NOMINEES_PER_TURN = 5;

export function getNomineesPerTurn(settings: unknown): number {
  if (typeof settings !== "object" || settings === null) {
    return DEFAULT_NOMINEES_PER_TURN;
  }
  const value = (settings as Record<string, unknown>).nomineesPerTurn;
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_NOMINEES_PER_TURN &&
    value <= MAX_NOMINEES_PER_TURN
  ) {
    return value;
  }
  return DEFAULT_NOMINEES_PER_TURN;
}
