// The text a chat app shows when someone pastes an invite link
// (docs/onboarding-spec.md §5.1; rebuild step 5e). Pure — no DB calls.
//
// The preview is visible to everyone in the chat, not just the invitee, so
// it says who invited you, to which club, and when it meets. Never anything
// about the members. Any invite that wouldn't let a stranger in right now
// (unknown, revoked or regenerated, used, club full) gets null: the
// generic defaults, nothing about any club.
import { resolveInviteView } from "./invites";

export function inviteShareText(input: {
  invite: { revokedAt: Date | null; redeemedAt: Date | null } | null;
  activeMemberCount: number;
  inviterName: string | null;
  clubName: string;
  scheduleLine: string;
}): { title: string; description: string } | null {
  // A link preview is fetched signed out, so the signed-out view decides.
  const view = resolveInviteView({
    invite: input.invite,
    activeMemberCount: input.activeMemberCount,
    viewer: null,
  });
  if (view !== "valid" || !input.inviterName) return null;
  const schedule = input.scheduleLine.endsWith(".") ? input.scheduleLine : `${input.scheduleLine}.`;
  return {
    title: `${input.inviterName} invited you to ${input.clubName}`,
    description: `Join ${input.clubName} on Kinomato. ${schedule}`,
  };
}
