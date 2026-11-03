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
