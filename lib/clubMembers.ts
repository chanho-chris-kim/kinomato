// Pure. No DB calls.
//
// Free tier cap: a product constant, not a clubs.settings value — there's
// no plan/tier column anywhere yet, same shape as the "two pushes per
// week" cap in CLAUDE.md (a product constraint, not a setting). Enforced
// server-side at the moment someone actually joins, not silently — a
// refused join needs a reason a person reads, not a form that does
// nothing.
export const FREE_TIER_MEMBER_CAP = 6;

export function canAddMember(activeMemberCount: number): boolean {
  return activeMemberCount < FREE_TIER_MEMBER_CAP;
}

// Two members with the same display name are indistinguishable on the
// identity picker's list of buttons — not unsafe, but confusing enough
// to guard against when someone's about to add themselves under a name
// that's already in the club.
export function isDisplayNameTaken(name: string, existingNames: string[]): boolean {
  const normalized = name.trim().toLowerCase();
  return existingNames.some((existing) => existing.trim().toLowerCase() === normalized);
}
