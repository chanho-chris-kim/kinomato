"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { invites } from "@/db/schema";
import {
  activeMemberCount,
  accountName,
  loadInviteByToken,
  redeemDestination,
  redeemInvite,
} from "@/app/invites";
import { issueSignIn } from "@/app/signIn";
import { endSession, getSessionUserId } from "@/app/session";
import { resolveInviteView } from "@/lib/invites";

// The invite landing page's three actions (docs/onboarding-spec.md §5.3,
// §7.4). Each re-checks the invite server-side: a Server Action is
// callable directly, not only through the page that rendered its form.

// Signed out, main path: email in, code out — completing sign-in redeems
// the invite (app/signIn.ts). started_at is set here, on the first email
// submitted, never on GET: chat apps' link previews open every URL.
export async function startInvite(token: string, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const row = await loadInviteByToken(db, token);
  const view = resolveInviteView({
    invite: row?.invite ?? null,
    activeMemberCount: row ? await activeMemberCount(db, row.club.id) : 0,
    viewer: null,
  });
  if (!row || view !== "valid") redirect(`/invite/${token}`);
  if (!email || !email.includes("@")) {
    redirect(`/invite/${token}?error=${encodeURIComponent("Enter a valid email address.")}`);
  }

  if (!row.invite.startedAt) {
    await db.update(invites).set({ startedAt: new Date() }).where(eq(invites.id, row.invite.id));
  }
  const result = await issueSignIn(db, { email, inviteId: row.invite.id });
  const qs = new URLSearchParams({ email });
  if (!result.sent) qs.set("notice", "wait");
  redirect(`/login/code?${qs.toString()}`);
}

// Ruling B, primary: the safe choice protects the person named on the link.
export async function signOutForInvite(token: string) {
  await endSession(getDb());
  redirect(`/invite/${token}`);
}

// Ruling B, secondary: join as the account already signed in. Never
// silent — only reachable from its own labelled button.
export async function joinInviteAsMe(token: string) {
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const userId = await getSessionUserId(db);
  const row = await loadInviteByToken(db, token);
  if (!userId || !row) redirect(`/invite/${token}`);
  const result = await redeemInvite(db, row.invite.id, userId);
  const destination = redeemDestination(result);
  // An account with no name at all still gets the name step first.
  if (!(await accountName(db, userId))) {
    redirect(`/welcome?${new URLSearchParams({ next: destination, invite: row.invite.id })}`);
  }
  redirect(destination);
}
