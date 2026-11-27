"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { issueSignIn, signupOpen } from "@/app/signIn";
import { codeScreenUrl, setSignInEmailCookie } from "@/app/signInCookie";
import { normaliseEmail } from "@/lib/emailAddress";
import { START_CLUB_PATH } from "@/lib/steps";

// "Start a club" (u4): the same sign-in as /login, carrying the flow as
// returnTo, so the code screen, /welcome and /new show its bar. The address
// goes in the sign-in cookie, never the URL (§11.6). The same rate limits,
// and the same next screen whether or not the address has an account.
export async function startClubSignIn(formData: FormData) {
  if (!signupOpen()) redirect("/login");
  const email = normaliseEmail(String(formData.get("email") ?? ""));
  if (!email || !email.includes("@")) {
    redirect(`/login/start?${new URLSearchParams({ error: "Enter a valid email address." })}`);
  }
  const result = await issueSignIn(getDb(), { email });
  await setSignInEmailCookie(email);
  redirect(codeScreenUrl(START_CLUB_PATH, result.sent ? undefined : "wait"));
}
