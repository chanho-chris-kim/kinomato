// Whose turn it is. Pure — no DB calls. Rotation is computed, never
// stored (CLAUDE.md), so callers pass every membership and night for the
// club on each call rather than reading a stored pointer.
//
// Order: postponed_at IS NULL, postponed_at ASC,
//        last_picked_at ASC NULLS FIRST, joined_at ASC, id ASC

export type NightState =
  | "draft"
  | "open"
  | "locked"
  | "watched"
  | "cancelled"
  | "unconfirmed";

export interface RotationMembership {
  id: string;
  // Who this membership belongs to. Carry-forward on a rejoin keys on it:
  // every membership is a user's (docs/onboarding-spec.md §8.2). Null
  // only for legacy guest rows during the step-4 cutover window, which are
  // never matched to anything.
  userId: string | null;
  clubId: string;
  joinedAt: Date;
  leftAt: Date | null;
  postponedAt: Date | null;
}

export interface RotationNight {
  pickerMembershipId: string;
  state: NightState;
  scheduledAt: Date;
}

export interface GetRotationOrderInput {
  // Every membership for the club, including ones that have left —
  // required to carry last_picked_at forward across a rejoin.
  memberships: RotationMembership[];
  nights: RotationNight[];
}

export interface GetNextPickerInput extends GetRotationOrderInput {
  clubPausedAt: Date | null;
}

function rawLastPickedAt(
  membershipId: string,
  nights: RotationNight[],
): Date | null {
  let max: Date | null = null;
  for (const n of nights) {
    if (n.pickerMembershipId !== membershipId) continue;
    // A cancelled night does not consume a turn — it's excluded entirely.
    // Every other state (including unconfirmed) does.
    if (n.state === "cancelled") continue;
    if (!max || n.scheduledAt.getTime() > max.getTime()) max = n.scheduledAt;
  }
  return max;
}

// Leaving and rejoining isn't a way to jump the queue: a membership's
// effective last_picked_at is the most recent pick across every prior
// membership of the same user in this club, not just this row.
function effectiveLastPickedAt(
  membership: RotationMembership,
  allMemberships: RotationMembership[],
  nights: RotationNight[],
): Date | null {
  // No user, no history to carry: null is not a shared identity.
  if (membership.userId === null) return rawLastPickedAt(membership.id, nights);
  const candidates = allMemberships.filter(
    (m) =>
      m.userId === membership.userId &&
      m.clubId === membership.clubId &&
      m.joinedAt.getTime() <= membership.joinedAt.getTime(),
  );

  let max: Date | null = null;
  for (const candidate of candidates) {
    const t = rawLastPickedAt(candidate.id, nights);
    if (t && (!max || t.getTime() > max.getTime())) max = t;
  }
  return max;
}

function compareRotationOrder(
  a: RotationMembership,
  b: RotationMembership,
  lastPicked: Map<string, Date | null>,
): number {
  const aPostponedIsNull = a.postponedAt === null;
  const bPostponedIsNull = b.postponedAt === null;
  if (aPostponedIsNull !== bPostponedIsNull) {
    return aPostponedIsNull ? 1 : -1; // non-null (postponed) sorts first
  }
  if (a.postponedAt && b.postponedAt) {
    const diff = a.postponedAt.getTime() - b.postponedAt.getTime();
    if (diff !== 0) return diff;
  }

  const aLast = lastPicked.get(a.id) ?? null;
  const bLast = lastPicked.get(b.id) ?? null;
  if (aLast === null && bLast !== null) return -1;
  if (aLast !== null && bLast === null) return 1;
  if (aLast !== null && bLast !== null) {
    const diff = aLast.getTime() - bLast.getTime();
    if (diff !== 0) return diff;
  }

  const joinDiff = a.joinedAt.getTime() - b.joinedAt.getTime();
  if (joinDiff !== 0) return joinDiff;

  // Trailing id ASC: not decoration. Without it, a tie between two
  // never-picked, same-instant-joined members is nondeterministic.
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function getRotationOrder(
  input: GetRotationOrderInput,
): RotationMembership[] {
  const active = input.memberships.filter((m) => m.leftAt === null);
  const lastPicked = new Map(
    active.map((m) => [
      m.id,
      effectiveLastPickedAt(m, input.memberships, input.nights),
    ]),
  );
  return [...active].sort((a, b) => compareRotationOrder(a, b, lastPicked));
}

export function getNextPicker(
  input: GetNextPickerInput,
): RotationMembership | null {
  if (input.clubPausedAt !== null) return null;
  return getRotationOrder(input)[0] ?? null;
}

const IN_FLIGHT_STATES: readonly NightState[] = ["draft", "open", "locked"];

// "Whose turn" on the club page answers "who is the club waiting on?"
// (CLAUDE.md ruling). While a draft, open or locked night exists, that's
// its picker — even though getNextPicker, which answers "who picks next",
// already counts that night as picked and names the member after them.
// Only with no night in flight does it fall back to getNextPicker.
//
// The in-flight picker is named even in a paused club, or if they've
// since left: the night is still waiting on them until it resolves.
export function getWhoseTurn(input: GetNextPickerInput): RotationMembership | null {
  const inFlight = input.nights.find((n) => IN_FLIGHT_STATES.includes(n.state));
  if (inFlight) {
    return input.memberships.find((m) => m.id === inFlight.pickerMembershipId) ?? null;
  }
  return getNextPicker(input);
}
