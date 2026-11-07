"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { safePath } from "@/app/baseUrl";
import { discardNewAccount, recordConsent } from "@/app/consent";
import { clearSessionCookie, getSessionUserId } from "@/app/session";
import { clearFormEcho, setFormEcho } from "@/app/formEcho";
import { readConsentForm } from "@/lib/consent";
import { validateMemberName } from "@/lib/memberName";

// The name step (docs/onboarding-spec.md §5.6), now with the consent
// controls (§11.1–§11.3): first name + last initial, age, the Terms box,
// and for 18 or older the optional data-sharing box. Saved in one batch.
// "Under 13" keeps nothing: the brand-new account is removed, and the
// person lands on a page that says why (§11.3).
export async function saveWelcome(formData: FormData) {
  const next = safePath(String(formData.get("next") ?? ""));
  const invite = String(formData.get("invite") ?? "");
  const firstName = String(formData.get("firstName") ?? "");
  const lastInitial = String(formData.get("lastInitial") ?? "");

  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const userId = await getSessionUserId();
  if (!userId) redirect(`/login`);
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) redirect(`/login`);
  // Already named: this account isn't new, and isn't this form's.
  if (user.displayName) redirect(next);

  const consent = readConsentForm(
    { age: formData.get("age"), terms: formData.get("terms"), licensing: formData.get("licensing") },
    { age: !user.ageBracket, terms: true },
  );
  if (consent.kind === "under_13") {
    await discardNewAccount(db, userId);
    await clearSessionCookie();
    redirect("/age-limit");
  }

  // What was typed goes back through the form-echo cookie, never the URL
  // (§11.6); only the fixed message and the paths ride in it.
  const back = async (error: string): Promise<never> => {
    const age = formData.get("age");
    await setFormEcho("/welcome", {
      first: firstName,
      initial: lastInitial,
      ...(typeof age === "string" && age ? { age } : {}),
    });
    const qs = new URLSearchParams({ next, error });
    if (invite) qs.set("invite", invite);
    redirect(`/welcome?${qs.toString()}`);
  };
  await clearFormEcho("/welcome");
  const name = validateMemberName(firstName, lastInitial);
  if ("error" in name) return back(name.error);
  if (consent.kind === "error") return back(consent.error);
  if (consent.kind !== "ok") return;

  await recordConsent(db, userId, { age: consent.age, licensing: consent.licensing, displayName: name.displayName });
  redirect(next);
}
