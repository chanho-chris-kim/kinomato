import { cookies } from "next/headers";

// What someone typed, carried back to a form after a validation error
// (docs/onboarding-spec.md §11.6), so names never ride in a redirect URL
// that Workers Logs would keep. ?error= stays in the URL: it's a fixed
// message, not personal. httpOnly, scoped to the one page the form is on,
// and short-lived. A Server Component can't delete a cookie while it
// renders, so "read once" is: the page reads it only when there's an
// ?error=, it expires in a minute, and the next submit clears it first.
export const FORM_ECHO_COOKIE = "kinomato_form_echo";
const MAX_AGE_SECONDS = 60;

type Echo = Record<string, string>;

export async function setFormEcho(path: string, values: Echo): Promise<void> {
  (await cookies()).set(FORM_ECHO_COOKIE, JSON.stringify(values), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path,
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function readFormEcho(): Promise<Echo> {
  const raw = (await cookies()).get(FORM_ECHO_COOKIE)?.value;
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === "string"),
    );
  } catch {
    return {};
  }
}

export async function clearFormEcho(path: string): Promise<void> {
  (await cookies()).delete({ name: FORM_ECHO_COOKIE, path });
}
