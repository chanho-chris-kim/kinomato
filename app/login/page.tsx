import { requestLogin } from "./actions";
import { PublicShell } from "@/app/shell";

// Email in, code out (docs/onboarding-spec.md §5.4). Reached directly
// (recovering on a new device) or from a gated page — returnTo (a
// same-origin path) is where the code screen sends them afterwards.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; returnTo?: string }>;
}) {
  const { error, returnTo } = await searchParams;

  return (
    <PublicShell>
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
              <input type="email" name="email" required autoFocus />
            </div>
          </label>
          {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
          <button type="submit" className="btn primary">
            Send code
          </button>
        </form>
      </main>
    </PublicShell>
  );
}
