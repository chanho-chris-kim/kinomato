import { requestLogin } from "./actions";

// Not an account page (CLAUDE.md rules that out) — just the sign-in
// surface the magic-link feature needs to exist at all: email in, link
// out. Reached either directly (recovering on a new device) or via a
// claim prompt's "already verified? sign in instead" — returnTo (a
// club id) is what gets a plain recovery login back to the club that
// prompted it, same as a claim link would.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string; returnTo?: string }>;
}) {
  const { error, sent, returnTo } = await searchParams;

  return (
    <main className="p-4" style={{ maxWidth: 480, margin: "0 auto" }}>
      <h1 className="h-display" style={{ fontSize: 26 }}>
        Sign in
      </h1>
      <p className="small muted mt-1">
        No password — enter your email and we&apos;ll send you a link.
      </p>

      {error && (
        <p className="small mt14" style={{ color: "var(--warn)" }}>
          {error}
        </p>
      )}

      {sent ? (
        <p className="small mt20">
          Check <strong>{sent}</strong> for a sign-in link. It works once and expires in 15
          minutes.
        </p>
      ) : (
        <form action={requestLogin} className="stack gap14 mt20">
          <label className="small muted">
            Email
            <div className="search mt-1">
              <input type="email" name="email" required autoFocus />
            </div>
          </label>
          {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
          <button type="submit" className="btn primary">
            Send my link
          </button>
        </form>
      )}
    </main>
  );
}
