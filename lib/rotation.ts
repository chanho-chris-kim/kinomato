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
  // Null for guests (v0 has no auth). Guests get no rejoin carry-forward,
  // since there's no stable identity to link an old membership to a new
  // one.
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
// membership the same user held in this club, not just this row.
function effectiveLastPickedAt(
  membership: RotationMembership,
  allMemberships: RotationMembership[],
  nights: RotationNight[],
): Date | null {
  const candidates =
    membership.userId === null
      ? [membership]
      : allMemberships.filter(
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
