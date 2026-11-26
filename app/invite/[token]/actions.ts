"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { invites, users } from "@/db/schema";
import { activeClubIdsByName, clashingClub } from "@/app/displayNameClash";
import { clearFormEcho, setFormEcho } from "@/app/formEcho";
import { validateDisplayName } from "@/lib/displayName";
import {
  activeMemberCount,
  accountName,
  loadInviteByToken,
  redeemDestination,
  redeemInvite,
} from "@/app/invites";
import { issueSignIn } from "@/app/signIn";
import { endSession, getSessionUserId } from "@/app/session";
import { codeScreenUrl, setSignInEmailCookie } from "@/app/signInCookie";
import { resolveInviteView } from "@/lib/invites";
import { normaliseEmail } from "@/lib/emailAddress";

// The invite landing page's three actions (docs/onboarding-spec.md §5.3,
// §7.4). Each re-checks the invite server-side: a Server Action is
// callable directly, not only through the page that rendered its form.

// Signed out, main path: email in, code out — completing sign-in redeems
// the invite (app/signIn.ts). started_at is set here, on the first email
// submitted, never on GET: chat apps' link previews open every URL.
export async function startInvite(token: string, formData: FormData) {
  const email = normaliseEmail(String(formData.get("email") ?? ""));
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
  // The address goes in the sign-in cookie, never the URL (§11.6).
  await setSignInEmailCookie(email);
  redirect(codeScreenUrl(undefined, result.sent ? undefined : "wait"));
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
  const userId = await getSessionUserId();
  const row = await loadInviteByToken(db, token);
  if (!userId || !row) redirect(`/invite/${token}`);
  // An account with no name at all gets the name step first, which joins
  // them once the name is chosen (ruled 2026-11-25).
  if (!(await accountName(db, userId))) {
    redirect(`/welcome?${new URLSearchParams({ next: "/", invite: row.invite.id })}`);
  }
  redirect(redeemDestination(await redeemInvite(db, row.invite.id, userId)));
}

// Joining with a display name someone in the club already has: the landing
// page asks for another (ruled 2026-11-25). It's the account's one name, so
// it must be free in every club they're in as well as this one; then they
// join. What was typed comes back through the form-echo cookie, never the
// URL (§11.6).
export async function joinInviteWithName(token: string, formData: FormData) {
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const userId = await getSessionUserId();
  const row = await loadInviteByToken(db, token);
  if (!userId || !row) redirect(`/invite/${token}`);
  if (!(await accountName(db, userId))) {
    redirect(`/welcome?${new URLSearchParams({ next: "/", invite: row.invite.id })}`);
  }
  const typed = String(formData.get("displayName") ?? "");
  const echoPath = `/invite/${token}`;
  await clearFormEcho(echoPath);
  const result = validateDisplayName(typed);
  if ("error" in result) {
    await setFormEcho(echoPath, { displayName: typed });
    redirect(`/invite/${token}?${new URLSearchParams({ nameTaken: "1", error: result.error })}`);
  }
  const takenIn = await clashingClub(db, userId, result.displayName, [
    row.invite.clubId,
    ...(await activeClubIdsByName(db, userId)),
  ]);
  if (takenIn) {
    await setFormEcho(echoPath, { displayName: result.displayName, takenIn });
    redirect(`/invite/${token}?nameTaken=1`);
  }
  await db.update(users).set({ displayName: result.displayName }).where(eq(users.id, userId));
  revalidatePath("/", "layout");
  redirect(redeemDestination(await redeemInvite(db, row.invite.id, userId)));
}
