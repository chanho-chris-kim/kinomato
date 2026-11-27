import { redirect } from "next/navigation";
import { PublicShell } from "@/app/shell";
import { StepBar } from "@/app/stepBar";
import { signupOpen } from "@/app/signIn";
import { START_CLUB_STEPS } from "@/lib/steps";
import { startClubSignIn } from "./actions";

// "Start a club" with sign-up open (u4, §5.13): the first step of its bar,
// Email. The flow is carried as returnTo "/new?start=1", a fixed path,
// never anything personal. Shown to everyone who enters this way, account
// or not (the next screens never reveal whether an address has one). With
// sign-up closed, it's plain sign-in.
export default async function StartClubEmailPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!signupOpen()) redirect("/login");
  const { error } = await searchParams;
  return (
    <PublicShell>
      <main className="p-4 signin-main">
        <StepBar steps={START_CLUB_STEPS} current={0} label="Starting a club" className="signup-steps" />
        <div className="card mt14 signin-card">
          <h1 className="h-display stage-title">Start a club</h1>
          <p className="small muted mt-1">First, your email. We&apos;ll send you a 6-digit code. No password, ever.</p>
          {error && (
            <p className="small mt14 warn" role="alert">
              {error}
            </p>
          )}
          <form action={startClubSignIn} className="stack gap14 mt20">
            <label className="small muted">
              Email
              <div className="search mt-1">
                <input type="email" name="email" required autoFocus autoComplete="email" />
              </div>
            </label>
            <button type="submit" className="btn primary">
              Send my code
            </button>
          </form>
        </div>
      </main>
    </PublicShell>
  );
}
