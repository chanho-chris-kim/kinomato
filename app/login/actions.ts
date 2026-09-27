"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { issueSignIn } from "@/app/signIn";

// Plain sign-in/recovery — no claimMembershipId, unlike requestClaim in
// app/clubs/[clubId]/actions.ts. This is what "identity survives a cleared
// cookie or a new device" (CLAUDE.md) runs on: the same users row is found
// again by email, so every membership tied to it is recognized at once.
//
// Always goes on to the code screen, sent or rate-limited, so the response
// never reveals whether an account exists (docs/onboarding-spec.md §4.3).
// Also the code screen's "Resend".
export async function requestLogin(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const returnTo = String(formData.get("returnTo") ?? "").trim() || undefined;

  if (!email || !email.includes("@")) {
    const qs = new URLSearchParams({ error: "Enter a valid email address." });
    if (returnTo) qs.set("returnTo", returnTo);
    redirect(`/login?${qs.toString()}`);
  }

  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const result = await issueSignIn(db, { email, returnToClubId: returnTo });
  redirect(codeScreenUrl(email, returnTo, result.sent ? undefined : "wait"));
}

function codeScreenUrl(email: string, returnTo?: string, notice?: string) {
  const qs = new URLSearchParams({ email });
  if (returnTo) qs.set("returnTo", returnTo);
  if (notice) qs.set("notice", notice);
  return `/login/code?${qs.toString()}`;
}
