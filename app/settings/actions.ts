"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { memberships, users } from "@/db/schema";
import { requireSignedInIgnoringConsent, requireUser } from "@/app/auth";
import { clearSessionCookie, endAllSessions, endOtherSessions, endSession } from "@/app/session";
import { cancelEmailChange, confirmEmailChange, requestEmailChange } from "@/app/emailChange";
import { optInToLicensing, withdrawFromLicensing } from "@/app/consent";
import { cancelAccountDeletion, confirmAccountDeletion, requestAccountDeletion } from "@/app/accountDeletion";
import { validateDisplayName } from "@/lib/displayName";
import { activeClubIdsByName, clashingClub } from "@/app/displayNameClash";
import { clearFormEcho, setFormEcho } from "@/app/formEcho";

// Settings (docs/onboarding-spec.md §5.9).

// Your display name (ruled 2026-11-25, u2): free text, 1–30 characters,
// and free in every club you're in, the first clash (by club name) named.
// Names live on the account, so a rename shows everywhere at once, past
// History nights and invite previews included (§5.9 ruling). A mistake
// goes back to the form (CLAUDE.md: validation errors redirect with
// ?error=), and nothing is saved; a clash names a person, so it comes back
// through the form-echo cookie with only a flag in the URL.
export async function updateName(formData: FormData) {
  const user = await requireUser("/settings");
  const typed = String(formData.get("displayName") ?? "");
  await clearFormEcho("/settings");
  const result = validateDisplayName(typed);
  if ("error" in result) {
    await setFormEcho("/settings", { displayName: typed });
    redirect(`/settings?${new URLSearchParams({ error: result.error })}`);
  }
  const db = getDb();
  const takenIn = await clashingClub(db, user.id, result.displayName, await activeClubIdsByName(db, user.id));
  if (takenIn) {
    await setFormEcho("/settings", { displayName: result.displayName, takenIn });
    redirect("/settings?nameTaken=1");
  }
  await db.update(users).set({ displayName: result.displayName }).where(eq(users.id, user.id));
  revalidatePath("/", "layout");
  redirect("/settings?saved=name");
}

// Sign out: this browser only. Its session row is deleted and the cookie
// cleared (app/session.ts).
export async function signOut() {
  await endSession(getDb());
  redirect("/");
}

// Sign out everywhere: every session for this account, this browser's
// included (§4.4). Reachable with consent pending (/consent's Sign out is
// the plain signOut above; neither may trap anyone).
export async function signOutEverywhere() {
  const user = await requireSignedInIgnoringConsent("/settings");
  await endAllSessions(getDb(), user.id);
  redirect("/");
}

// Email change (§5.9 rulings; rebuild step 7b): the logic is in
// app/emailChange.ts, the only code that touches email_changes. Every
// outcome comes back to /settings; the request's screen is the same
// whether or not the new address already has an account.
export async function requestEmailChangeAction(formData: FormData) {
  const user = await requireUser("/settings");
  const result = await requestEmailChange(getDb(), user, String(formData.get("newEmail") ?? ""), new Date());
  redirect(result.ok ? "/settings?emailChange=sent" : `/settings?${new URLSearchParams({ emailError: result.error })}`);
}

export async function confirmEmailChangeAction(formData: FormData) {
  const user = await requireUser("/settings");
  const db = getDb();
  const result = await confirmEmailChange(db, user, String(formData.get("code") ?? ""), new Date(), () =>
    endOtherSessions(db, user.id),
  );
  if (result.ok) revalidatePath("/", "layout");
  redirect(result.ok ? "/settings?emailChange=changed" : `/settings?${new URLSearchParams({ emailError: result.error })}`);
}

export async function cancelEmailChangeAction() {
  const user = await requireUser("/settings");
  await cancelEmailChange(getDb(), user.id, new Date());
  redirect("/settings");
}

// How we reach you (docs/onboarding-spec.md §5.9, ruled 2026-11-23):
// reminder emails on or off, and a per-club mute. Only reminders look at
// these; sign-in codes and account notices always arrive.
export async function setEmailReminders(on: boolean) {
  const user = await requireUser("/settings");
  await getDb().update(users).set({ emailReminders: on }).where(eq(users.id, user.id));
  redirect("/settings?saved=reminders#reminders");
}

// Only the viewer's own active membership in that club; anything else (a
// club they're not in, or have left) changes nothing.
export async function setClubRemindersMuted(clubId: string, muted: boolean) {
  const user = await requireUser("/settings");
  await getDb()
    .update(memberships)
    .set({ remindersMutedAt: muted ? new Date() : null })
    .where(and(eq(memberships.userId, user.id), eq(memberships.clubId, clubId), isNull(memberships.leftAt)));
  redirect("/settings?saved=reminders#reminders");
}

// Data sharing (docs/onboarding-spec.md §11.2): 18 or older only, checked
// again in app/consent.ts whatever the page showed. Opting in writes a
// row; withdrawing sets that row's withdrawn_at, from now on only.
export async function optInToLicensingAction() {
  const user = await requireUser("/settings");
  await optInToLicensing(getDb(), user.id);
  redirect("/settings?sharing=on#data-sharing");
}

export async function withdrawFromLicensingAction() {
  const user = await requireUser("/settings");
  await withdrawFromLicensing(getDb(), user.id);
  redirect("/settings?sharing=off#data-sharing");
}

// Delete account (docs/onboarding-spec.md §11.4; launch foundations (f)).
// The logic is in app/accountDeletion.ts. A code to the account's own
// address, entered on /settings/delete-account, which lists what happens
// to each club. Mistakes come back there with ?error= (fixed messages).
export async function requestAccountDeletionAction() {
  const user = await requireUser("/settings");
  const result = await requestAccountDeletion(getDb(), user, new Date());
  redirect(
    result.ok ? "/settings/delete-account" : `/settings?${new URLSearchParams({ deleteError: result.error })}#delete-account`,
  );
}

export async function confirmAccountDeletionAction(formData: FormData) {
  const user = await requireUser("/settings/delete-account");
  const result = await confirmAccountDeletion(getDb(), user, String(formData.get("code") ?? ""), new Date());
  if (!result.ok) redirect(`/settings/delete-account?${new URLSearchParams({ error: result.error })}`);
  // Every session is already gone (the anonymisation); this browser's
  // cookie goes too.
  await clearSessionCookie();
  redirect("/account-deleted");
}

export async function cancelAccountDeletionAction() {
  const user = await requireUser("/settings/delete-account");
  await cancelAccountDeletion(getDb(), user.id, new Date());
  redirect("/settings");
}
