"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { completeSignIn, latestSignInFor } from "@/app/signIn";
import { checkSignInCode } from "@/app/signInCode";
import { getSignInEmail, loginAgainUrl } from "@/app/signInCookie";

// The primary sign-in path (docs/onboarding-spec.md §4.2). Only the newest
// code sent to an address counts. Every outcome that isn't success lands
// back on the code screen with a message, via the ?error= convention.
export async function submitCode(formData: FormData) {
  const code = String(formData.get("code") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "").trim() || undefined;
  // The address is the sign-in cookie's, never the form's or the URL's
  // (§11.6). Gone means the 15 minutes are up: start again at /login.
  const email = await getSignInEmail();
  if (!email) redirect(loginAgainUrl(returnTo));
  const back = (error: string, extra: Record<string, string> = {}) => {
    const qs = new URLSearchParams({ error, ...extra });
    if (returnTo) qs.set("returnTo", returnTo);
    redirect(`/login/code?${qs.toString()}`);
  };

  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const link = await latestSignInFor(db, email!);
  if (!link) back("expired");
  // A try is claimed in the database before the code is compared
  // (app/signInCode.ts), so simultaneous guesses can't share one.
  const checked = await checkSignInCode(db, link!, code, new Date());
  if (!checked.ok) {
    if (checked.error === "wrong") back("wrong", { left: String(checked.left) });
    else back(checked.error);
  }

  const destination = await completeSignIn(db, link!.id, returnTo);
  if (!destination) back("consumed");
  redirect(destination!);
}
