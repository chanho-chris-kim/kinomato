"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { requireSignedInIgnoringConsent, requireUser } from "@/app/auth";
import { clearSessionCookie, endAllSessions, endSession } from "@/app/session";
import { cancelEmailChange, confirmEmailChange, requestEmailChange } from "@/app/emailChange";
import { optInToLicensing, withdrawFromLicensing } from "@/app/consent";
import { cancelAccountDeletion, confirmAccountDeletion, requestAccountDeletion } from "@/app/accountDeletion";
import { validateMemberName } from "@/lib/memberName";
import { clearFormEcho, setFormEcho } from "@/app/formEcho";

// Settings (docs/onboarding-spec.md §5.9).

// Your name: first name + last initial, the same validation as the name
// step (§5.6). Names live on the account, so a rename shows everywhere at
// once, past History nights and invite previews included (§5.9 ruling).
// A mistake goes back to the form with the message (CLAUDE.md: validation
// errors redirect with ?error=), and nothing is saved.
export async function updateName(formData: FormData) {
  const user = await requireUser("/settings");
  const firstName = String(formData.get("firstName") ?? "");
  const lastInitial = String(formData.get("lastInitial") ?? "");
  await clearFormEcho("/settings");
  const result = validateMemberName(firstName, lastInitial);
  if ("error" in result) {
    // What was typed goes back through the form-echo cookie, never the
    // URL (§11.6).
    await setFormEcho("/settings", { first: firstName, initial: lastInitial });
    redirect(`/settings?${new URLSearchParams({ error: result.error })}`);
  }
  await getDb().update(users).set({ displayName: result.displayName }).where(eq(users.id, user.id));
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
  const result = await confirmEmailChange(getDb(), user, String(formData.get("code") ?? ""), new Date());
  if (result.ok) revalidatePath("/", "layout");
  redirect(result.ok ? "/settings?emailChange=changed" : `/settings?${new URLSearchParams({ emailError: result.error })}`);
}

export async function cancelEmailChangeAction() {
  const user = await requireUser("/settings");
  await cancelEmailChange(getDb(), user.id, new Date());
  redirect("/settings");
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
