import Link from "next/link";
import { requestLogin } from "../actions";
import { submitCode } from "./actions";
import { redirect } from "next/navigation";
import { PublicShell } from "@/app/shell";
import { getSignInEmail, loginAgainUrl } from "@/app/signInCookie";
import { maskEmail } from "@/lib/emailAddress";

// "Check your email" (docs/onboarding-spec.md §5.5): the code leads,
// because it's typed into the tab that asked for it. One field, not six
// boxes: a single input with autocomplete="one-time-code" is what iOS and
// Android reliably autofill from the notification, and pasting a whole
// code into it needs no script.
const MESSAGES: Record<string, (left?: string) => string> = {
  wrong: (left) => `That code didn't match. ${left} ${left === "1" ? "try" : "tries"} left.`,
  locked: () => "Too many tries. Send a new code.",
  expired: () => "That code expired. Send a new one.",
  consumed: () => "That code has already been used. Send a new one if you need to sign in again.",
};

export default async function CodePage({
  searchParams,
}: {
  searchParams: Promise<{
    returnTo?: string;
    error?: string;
    left?: string;
    notice?: string;
  }>;
}) {
  const { returnTo, error, left, notice } = await searchParams;
  // The address comes from the sign-in cookie, never the URL (§11.6), and
  // is shown masked: the person knows which one they typed.
  const email = await getSignInEmail();
  if (!email) redirect(loginAgainUrl(returnTo));
  const deadEnd = error === "locked" || error === "expired" || error === "consumed";
  const differentEmail = returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : "/login";

  return (
    <PublicShell>
      <main className="p-4" style={{ maxWidth: 480, margin: "0 auto" }}>
        <h1 className="h-display" style={{ fontSize: 26 }}>
          Check your email
        </h1>
        <p className="small muted mt-1">
          We sent a 6-digit code to <strong className="masked-email">{maskEmail(email)}</strong>. It expires in 15 minutes.
        </p>

        {notice === "wait" && (
          <p className="small mt14">We just sent one. Check your inbox, or try again in a minute.</p>
        )}
        {error && MESSAGES[error] && (
          <p className="small mt14" style={{ color: "var(--warn)" }}>
            {MESSAGES[error](left)}
          </p>
        )}

        {!deadEnd && (
          <form action={submitCode} className="stack gap14 mt20">
            <label className="small muted">
              Code
              <div className="search mt-1">
                <input
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9 ]*"
                  maxLength={7}
                  required
                  autoFocus
                  aria-label="6-digit code"
                />
              </div>
            </label>
            {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
            <button type="submit" className="btn primary">
              Sign in
            </button>
            <p className="tiny dim" style={{ margin: 0 }}>
              Or tap the link in the same email.
            </p>
          </form>
        )}

        <form action={requestLogin} className="mt20">
          {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
          <button type="submit" className={deadEnd ? "btn primary" : "btn ghost"}>
            {deadEnd ? "Send a new code" : "Resend"}
          </button>
        </form>
        <p className="small mt14">
          <Link href={differentEmail} className="underline">
            Use a different email
          </Link>
        </p>
      </main>
    </PublicShell>
  );
}
