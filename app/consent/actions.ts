"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { anonymiseAccount } from "@/app/anonymise";
import { requireSignedInIgnoringConsent } from "@/app/auth";
import { safePath } from "@/app/baseUrl";
import { consentGapsFor, recordConsent } from "@/app/consent";
import { clearSessionCookie } from "@/app/session";
import { clearFormEcho, setFormEcho } from "@/app/formEcho";
import { readConsentForm } from "@/lib/consent";

// /consent's form (docs/onboarding-spec.md §11.1–§11.3): an existing
// account accepting the current versions, and saying its age if it was
// never asked. "Under 13" on an existing account anonymises it (§11.4,
// app/anonymise.ts): it has data others' history references, so it can't
// simply vanish the way a brand-new account does on /welcome.
export async function submitConsent(formData: FormData) {
  const next = safePath(String(formData.get("next") ?? ""));
  const user = await requireSignedInIgnoringConsent("/consent");
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const gaps = await consentGapsFor(db, user);
  if (gaps.length === 0) redirect(next);

  const consent = readConsentForm(
    { age: formData.get("age"), terms: formData.get("terms"), licensing: formData.get("licensing") },
    { age: gaps.includes("age"), terms: gaps.includes("terms") || gaps.includes("privacy") },
  );
  if (consent.kind === "under_13") {
    await anonymiseAccount(db, user.id);
    await clearSessionCookie();
    redirect("/age-limit");
  }
  await clearFormEcho("/consent");
  if (consent.kind === "error") {
    // The age chosen comes back through the form-echo cookie, not the URL.
    const age = formData.get("age");
    if (typeof age === "string" && age) await setFormEcho("/consent", { age });
    redirect(`/consent?${new URLSearchParams({ next, error: consent.error })}`);
  }
  await recordConsent(db, user.id, { age: consent.age, licensing: consent.licensing });
  redirect(next);
}
