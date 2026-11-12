// Leaving a club (docs/onboarding-spec.md §5.10, ruled 2026-11-11). Pure.
// One heir rule everywhere: the same as account deletion's
// (lib/accountDeletion.ts planDeletion), so leaving and deleting your
// account hand a club to the same person.

import { planDeletion } from "./accountDeletion";

type Role = "owner" | "admin" | "member" | "guest";

export type LeavePlan =
  | { kind: "leave" }
  | { kind: "transfer"; heirMembershipId: string }
  // The last active member (pending invites don't count) can't simply
  // leave: they pause the club or delete it.
  | { kind: "last_member" };

// `others`: the club's other *active* members.
export function planLeave(myRole: Role, others: { membershipId: string; role: Role; joinedAt: Date }[]): LeavePlan {
  const [plan] = planDeletion([{ clubId: "", myRole, others }]);
  switch (plan.action) {
    case "delete_club":
      return { kind: "last_member" };
    case "transfer":
      return { kind: "transfer", heirMembershipId: plan.toMembershipId };
    case "leave":
      return { kind: "leave" };
  }
}
