import { requestLogin } from "./actions";

// Email in, code out (docs/onboarding-spec.md §5.4). Reached directly
// (recovering on a new device) or from a claim prompt's "already verified?
// sign in instead" — returnTo (a club id) brings a recovery sign-in back
// to the club that prompted it. `email` prefills the field when a stale
// link sends someone here.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; returnTo?: string; email?: string }>;
}) {
  const { error, returnTo, email } = await searchParams;

  return (
    <main className="p-4" style={{ maxWidth: 480, margin: "0 auto" }}>
      <h1 className="h-display" style={{ fontSize: 26 }}>
        Sign in
      </h1>
      <p className="small muted mt-1">
        No password — enter your email and we&apos;ll send you a 6-digit code.
      </p>

      {error && (
        <p className="small mt14" style={{ color: "var(--warn)" }}>
          {error}
        </p>
      )}

      <form action={requestLogin} className="stack gap14 mt20">
        <label className="small muted">
          Email
          <div className="search mt-1">
            <input type="email" name="email" required autoFocus defaultValue={email} />
          </div>
        </label>
        {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
        <button type="submit" className="btn primary">
          Send code
        </button>
      </form>
    </main>
  );
}
