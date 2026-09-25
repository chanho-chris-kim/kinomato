import { requestClaim } from "./actions";

// Prompted at the moment of loss aversion, not on arrival (CLAUDE.md,
// analysis-v2.md §5.1) — this only ever renders because a caller
// decided the specific risk (watchlist size, unclaimed ownership) is
// already true, never as a generic "consider signing up" banner.
// Never a wall: ignoring this changes nothing about what a guest can
// already do.
export function ClaimPrompt({
  clubId,
  returnPath,
  reason,
  claimError,
  claimSent,
}: {
  clubId: string;
  returnPath: string;
  reason: "watchlist" | "owner";
  claimError?: string;
  claimSent?: string;
}) {
  if (claimSent) {
    return (
      <div className="note mt20">
        <p className="small" style={{ margin: 0 }}>
          Check <strong>{claimSent}</strong> for a sign-in link. It works once and expires in
          15 minutes.
        </p>
      </div>
    );
  }

  const copy =
    reason === "owner"
      ? "You're this club's only owner. If you clear your cookies or lose this device, nobody can rotate the invite link, change settings, or manage this club again."
      : "If you clear your cookies or switch phones, you'll lose this list and your place in the rotation.";

  return (
    <div className="note mt20">
      <p className="tiny" style={{ margin: "0 0 5px", color: "var(--accent)" }}>
        Save your spot
      </p>
      <p className="small" style={{ margin: "0 0 10px" }}>
        {copy}
      </p>
      {claimError && (
        <p className="tiny" style={{ margin: "0 0 10px", color: "var(--warn)" }}>
          {claimError}
        </p>
      )}
      <form action={requestClaim.bind(null, clubId, returnPath)} className="row gap8">
        <div className="search" style={{ flex: 1 }}>
          <input type="email" name="email" placeholder="you@example.com" required />
        </div>
        <button type="submit" className="btn" style={{ width: "auto" }}>
          Verify email
        </button>
      </form>
      <p className="tiny dim mt14" style={{ margin: "14px 0 0" }}>
        Already verified?{" "}
        <a href={`/login?returnTo=${clubId}`} className="underline">
          Sign in
        </a>{" "}
        instead.
      </p>
    </div>
  );
}
