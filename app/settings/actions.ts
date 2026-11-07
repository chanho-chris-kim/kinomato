"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { requireUser } from "@/app/auth";
import { endAllSessions, endSession } from "@/app/session";
import { cancelEmailChange, confirmEmailChange, requestEmailChange } from "@/app/emailChange";
import { validateMemberName } from "@/lib/memberName";

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
  const result = validateMemberName(firstName, lastInitial);
  if ("error" in result) {
    const qs = new URLSearchParams({ error: result.error, first: firstName, initial: lastInitial });
    redirect(`/settings?${qs}`);
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
// included (§4.4).
export async function signOutEverywhere() {
  const user = await requireUser("/settings");
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
  redirect(result.ok ? "/settings?email=sent" : `/settings?${new URLSearchParams({ emailError: result.error })}`);
}

export async function confirmEmailChangeAction(formData: FormData) {
  const user = await requireUser("/settings");
  const result = await confirmEmailChange(getDb(), user, String(formData.get("code") ?? ""), new Date());
  if (result.ok) revalidatePath("/", "layout");
  redirect(result.ok ? "/settings?email=changed" : `/settings?${new URLSearchParams({ emailError: result.error })}`);
}

export async function cancelEmailChangeAction() {
  const user = await requireUser("/settings");
  await cancelEmailChange(getDb(), user.id, new Date());
  redirect("/settings");
}
