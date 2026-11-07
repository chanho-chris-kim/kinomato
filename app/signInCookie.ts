import { cookies } from "next/headers";
import { SIGN_IN_DURATION_MS } from "@/lib/authCredentials";
import { normaliseEmail } from "@/lib/emailAddress";

// The address someone is signing in with, held for the code screen
// (docs/onboarding-spec.md §11.6): never in a URL, because Workers Logs
// keep every request URL. First-party, httpOnly, only sent to /login and
// /login/code (and their server actions), gone when the code would be,
// and deleted on a successful sign-in (app/signIn.ts completeSignIn).
export const SIGN_IN_EMAIL_COOKIE = "kinomato_signin_email";
const PATH = "/login";

export async function setSignInEmailCookie(email: string): Promise<void> {
  (await cookies()).set(SIGN_IN_EMAIL_COOKIE, email, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: PATH,
    maxAge: SIGN_IN_DURATION_MS / 1000,
  });
}

// The address, or null when the cookie is missing or has expired.
export async function getSignInEmail(): Promise<string | null> {
  const value = (await cookies()).get(SIGN_IN_EMAIL_COOKIE)?.value;
  const email = value ? normaliseEmail(value) : "";
  return email.includes("@") ? email : null;
}

export async function clearSignInEmailCookie(): Promise<void> {
  (await cookies()).delete({ name: SIGN_IN_EMAIL_COOKIE, path: PATH });
}

// The code screen, with only what isn't personal in its URL: where to go
// afterwards (a path) and the rate-limit notice.
export function codeScreenUrl(returnTo?: string, notice?: string): string {
  const qs = new URLSearchParams();
  if (returnTo) qs.set("returnTo", returnTo);
  if (notice) qs.set("notice", notice);
  const query = qs.toString();
  return query ? `/login/code?${query}` : "/login/code";
}

// Where the code screen sends someone once it no longer knows the address
// (the cookie expired, or this is another browser): /login, with a plain
// message — a fixed string, not personal.
export const SIGN_IN_TIMED_OUT = "Your sign-in timed out. Enter your email to get a new code.";

export function loginAgainUrl(returnTo?: string): string {
  const qs = new URLSearchParams({ error: SIGN_IN_TIMED_OUT });
  if (returnTo) qs.set("returnTo", returnTo);
  return `/login?${qs.toString()}`;
}
