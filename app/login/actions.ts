"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { issueSignIn } from "@/app/signIn";
import { codeScreenUrl, getSignInEmail, setSignInEmailCookie } from "@/app/signInCookie";
import { normaliseEmail } from "@/lib/emailAddress";

// Plain sign-in/recovery. This is what "identity survives a cleared cookie
// or a new device" (CLAUDE.md) runs on: the same users row is found again
// by email, so every membership tied to it is recognized at once.
// returnTo is a same-origin path (a gated page sent the person here) and
// rides along in the code screen's URL — it's never stored. The address
// never does (§11.6): it goes in the sign-in cookie (app/signInCookie.ts).
//
// Always goes on to the code screen, sent or rate-limited, so the response
// never reveals whether an account exists (docs/onboarding-spec.md §4.3).
// Also the code screen's "Resend", which sends no address: it's the one
// in the cookie.
export async function requestLogin(formData: FormData) {
  const typed = normaliseEmail(String(formData.get("email") ?? ""));
  const email = typed || (await getSignInEmail()) || "";
  const returnTo = String(formData.get("returnTo") ?? "").trim() || undefined;

  if (!email || !email.includes("@")) {
    const qs = new URLSearchParams({ error: "Enter a valid email address." });
    if (returnTo) qs.set("returnTo", returnTo);
    redirect(`/login?${qs.toString()}`);
  }

  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const result = await issueSignIn(db, { email });
  await setSignInEmailCookie(email);
  redirect(codeScreenUrl(returnTo, result.sent ? undefined : "wait"));
}
