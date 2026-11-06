import { requireUser } from "@/app/auth";
import { GlobalShell } from "@/app/shell";
import { parseInviteeName } from "@/lib/invites";
import { signOut, signOutEverywhere, updateName } from "./actions";

// Settings (docs/onboarding-spec.md §5.9). Built: your name and both sign
// outs (rebuild step 7a). Email change is step 7b. Notifications wait for
// the notifications feature, and the Privacy and Terms links for those
// pages (§5.9 rulings). Nothing else goes here until it's built — no
// "coming soon".
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; first?: string; initial?: string; saved?: string }>;
}) {
  const { error, first, initial, saved } = await searchParams;
  const user = await requireUser("/settings");
  // After a mistake, the form shows what was typed; otherwise the saved name.
  const current = parseInviteeName(user.displayName ?? "");
  const firstName = error ? (first ?? "") : current.firstName;
  const lastInitial = error ? (initial ?? "") : current.lastInitial;

  return (
    <GlobalShell current="settings">
      <h1 className="h-display" style={{ fontSize: 22 }}>
        Settings
      </h1>

      <section className="mt20" aria-labelledby="your-name">
        <h2 id="your-name" className="sec">
          Your name
        </h2>
        <p className="small muted" style={{ margin: "4px 0 0" }}>
          First name and last initial. It&apos;s how you show up in every club.
        </p>
        {error && (
          <p className="small mt-1" role="alert" style={{ color: "var(--warn)" }}>
            {error}
          </p>
        )}
        {saved === "name" && !error && (
          <p className="small mt-1" role="status" style={{ color: "var(--accent)" }}>
            Saved.
          </p>
        )}
        <form action={updateName} className="row gap8 mt14" style={{ alignItems: "flex-end" }}>
          <label className="small muted" style={{ flex: 3, minWidth: 0 }}>
            First name
            <div className="search mt-1">
              <input name="firstName" defaultValue={firstName} required autoComplete="given-name" />
            </div>
          </label>
          <label className="small muted" style={{ flex: 1, minWidth: 0 }}>
            Last initial
            <div className="search mt-1">
              <input name="lastInitial" defaultValue={lastInitial} required maxLength={1} />
            </div>
          </label>
          <button type="submit" className="btn" style={{ width: "auto", whiteSpace: "nowrap" }}>
            Save name
          </button>
        </form>
      </section>

      <section className="mt20" aria-labelledby="signing-out">
        <h2 id="signing-out" className="sec">
          Signing out
        </h2>
        <div className="stack gap8 mt14" style={{ maxWidth: 360 }}>
          <form action={signOut}>
            <button type="submit" className="btn">
              Sign out
            </button>
          </form>
          <p className="tiny dim" style={{ margin: 0 }}>
            Signs out this browser only.
          </p>
          <form action={signOutEverywhere} className="mt14">
            <button type="submit" className="btn ghost">
              Sign out everywhere
            </button>
          </form>
          <p className="tiny dim" style={{ margin: 0 }}>
            Signs out every device and browser you&apos;re signed in on, this one included.
          </p>
        </div>
      </section>
    </GlobalShell>
  );
}
