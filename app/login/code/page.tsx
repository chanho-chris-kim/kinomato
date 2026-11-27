import Link from "next/link";
import { requestLogin } from "../actions";
import { submitCode } from "./actions";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { PublicShell } from "@/app/shell";
import { StepBar } from "@/app/stepBar";
import { InviteCard } from "@/app/inviteCard";
import { loadInviteById } from "@/app/invites";
import { latestSignInFor, resendWaitSeconds } from "@/app/signIn";
import { getSignInEmail, loginAgainUrl } from "@/app/signInCookie";
import { maskEmail } from "@/lib/emailAddress";
import { SIGN_UP_STEPS, START_CLUB_PATH, START_CLUB_STEPS } from "@/lib/steps";
import { signupOpen } from "@/app/signIn";
import { ResendButton } from "./ResendButton";

// "Check your email" (docs/onboarding-spec.md §5.5; redesigned u3): the code
// leads, because it's typed into the tab that asked for it. ONE real input
// (autocomplete="one-time-code", which iOS and Android autofill from the
// notification), drawn as six boxes behind it, so pasting a whole code,
// autofill and screen readers all work, with or without script.
//
// The screen is the same for every address (never "Welcome back"): it
// changes only with how this sign-in started. A code first requested from
// an invite link (that address's newest code carries the invite) shows the
// sign-up step bar and the invite; it never depends on whether an account
// exists, which would tell anyone typing an address whether it has one.
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
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  // eslint-disable-next-line react-hooks/purity -- a Server Component, once per request
  const now = new Date(Date.now());
  const [latest, waitSeconds] = await Promise.all([latestSignInFor(db, email!), resendWaitSeconds(db, email!, now)]);
  const invited = latest?.inviteId && !latest.consumedAt ? await loadInviteById(db, latest.inviteId) : null;
  const masked = <strong className="masked-email">{maskEmail(email!)}</strong>;
  // "Start a club" with sign-up open (u4): its own bar, from returnTo alone.
  const startingClub = !invited && returnTo === START_CLUB_PATH && signupOpen();

  return (
    <PublicShell>
      <main className="p-4 signin-main">
        {invited && <StepBar steps={SIGN_UP_STEPS} current={1} label="Signing up" className="signup-steps" />}
        {invited && <InviteCard inviterName={invited.inviterName ?? "Someone"} clubName={invited.club.name} />}
        {startingClub && <StepBar steps={START_CLUB_STEPS} current={1} label="Starting a club" className="signup-steps" />}
        <div className="card mt14 signin-card">
          <h1 className="h-display stage-title">Check your email</h1>
          {invited || startingClub ? (
            <p className="small muted mt-1">We sent a 6-digit code to {masked}.</p>
          ) : (
            <p className="small muted mt-1">
              Sent to {masked} ·{" "}
              <Link href={differentEmail} className="underline tap">
                Change
              </Link>
            </p>
          )}

          {notice === "wait" && (
            <p className="small mt14">We just sent one. Check your inbox, or try again in a moment.</p>
          )}
          {error && MESSAGES[error] && (
            <p className="small mt14 warn" role="alert">
              {MESSAGES[error](left)}
            </p>
          )}

          {!deadEnd && (
            <form action={submitCode} className="stack gap14 mt20">
              <label className="small muted" htmlFor="code">
                Your code
              </label>
              <div className="code-boxes">
                {Array.from({ length: 6 }, (_, i) => (
                  <span key={i} className="code-box" aria-hidden="true" />
                ))}
                <input
                  id="code"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  autoFocus
                  aria-describedby="code-tip"
                />
              </div>
              <p id="code-tip" className="tiny dim flush">
                Tip: paste the whole code, or tap the link in the same email.
              </p>
              {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
              <button type="submit" className="btn primary">
                Sign in
              </button>
            </form>
          )}
        </div>

        <section className="card mt14 resend-box" aria-labelledby="resend-heading">
          <h2 id="resend-heading" className="sec">
            Didn&apos;t get it?
          </h2>
          <p className="small muted flush">Check spam or promotions. Codes last 15 minutes.</p>
          <form action={requestLogin} className="mt14">
            {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
            <ResendButton
              waitSeconds={waitSeconds}
              label={deadEnd ? "Send a new code" : "Resend"}
              primary={deadEnd}
            />
          </form>
          <p className="small mt14 flush">
            <Link href={differentEmail} className="underline tap">
              Use a different email
            </Link>
          </p>
        </section>
      </main>
    </PublicShell>
  );
}
