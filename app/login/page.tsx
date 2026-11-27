import { requestLogin } from "./actions";
import { PublicShell } from "@/app/shell";
import { signupOpen } from "@/app/signIn";

// Email in, code out (docs/onboarding-spec.md §5.4; redesigned u3). A
// returning sign-in: no step bar. Reached directly (recovering on a new
// device) or from a gated page — returnTo (a same-origin path) is where the
// code screen sends them afterwards. Stacked on phones; from 900px, what
// Kinomato is on the left and the sign-in card on the right.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; returnTo?: string }>;
}) {
  const { error, returnTo } = await searchParams;

  return (
    <PublicShell>
      <main className="p-4 signin-split">
        {/* Shown from 900px. Its title isn't a heading: it comes before the
            page's h1 ("Sign in") in reading order. */}
        <section className="signin-pitch" aria-label="What Kinomato is">
          <p className="h-display pitch-title flush">Movie night, sorted.</p>
          <p className="muted mt-1">Your club takes turns picking, votes on the films, and remembers every night.</p>
          <ol className="pitch-steps plain-list mt14">
            <li>
              <span className="pitch-n" aria-hidden="true">
                1
              </span>
              <span>
                <strong>Pick.</strong> Whoever&apos;s turn it is nominates a few films from their list.
              </span>
            </li>
            <li>
              <span className="pitch-n" aria-hidden="true">
                2
              </span>
              <span>
                <strong>Vote.</strong> Everyone votes, and the pick locks before the night.
              </span>
            </li>
            <li>
              <span className="pitch-n" aria-hidden="true">
                3
              </span>
              <span>
                <strong>Watch and rate.</strong> Ratings stay hidden until everyone who came has rated.
              </span>
            </li>
          </ol>
        </section>

        <div className="card signin-card">
          <h1 className="h-display stage-title">Sign in</h1>
          <p className="small muted mt-1">No password, ever. We&apos;ll email you a 6-digit code.</p>
          {/* From /join (u5): a code joins an account to a club, it can't
              make one while sign-up is closed (lib/signupGate.ts). */}
          {returnTo === "/join" && !signupOpen() && (
            <p className="small mt14 join-needs-account">
              Sign in to join a club with its code. You need an account first, and Kinomato is
              invite-only for now: to make one, ask someone in a club for a personal invite link.
            </p>
          )}

          {error && (
            <p className="small mt14 warn" role="alert">
              {error}
            </p>
          )}

          <form action={requestLogin} className="stack gap14 mt20">
            <label className="small muted">
              Email
              <div className="search mt-1">
                <input type="email" name="email" required autoFocus autoComplete="email" />
              </div>
            </label>
            {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
            <button type="submit" className="btn primary">
              Send my code
            </button>
          </form>
          {!signupOpen() && (
            <p className="tiny dim mt14 flush invite-only-note">
              New here? Kinomato is invite-only for now. Ask someone in a club to invite you.
            </p>
          )}
        </div>
      </main>
    </PublicShell>
  );
}
