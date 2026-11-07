import { getDb } from "@/db";
import { requireSignedInIgnoringConsent } from "@/app/auth";
import { safePath } from "@/app/baseUrl";
import { consentEventsFor, licensingStatusFor } from "@/app/consent";
import { ConsentFields } from "@/app/consentFields";
import { PublicShell } from "@/app/shell";
import { readFormEcho } from "@/app/formEcho";
import { signOut } from "@/app/settings/actions";
import { acceptanceMethod, canOptInToLicensing, isLicensingActive, needsConsent } from "@/lib/consent";
import { currentLegal } from "@/lib/legal";
import { redirect } from "next/navigation";
import { submitConsent } from "./actions";

// Where the consent gate (app/auth.ts) sends an existing account that's
// missing a current acceptance or its age (docs/onboarding-spec.md §11.1,
// §11.3): the same controls as /welcome, minus the name. No banner and no
// way round it, but Sign out is always here, and the Terms and Privacy
// pages open beside it, so nobody is trapped.
export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next: rawNext, error } = await searchParams;
  const { age } = error ? await readFormEcho() : {};
  const next = safePath(rawNext);
  const user = await requireSignedInIgnoringConsent(`/consent?${new URLSearchParams({ next })}`);
  if (!user.displayName) redirect(`/welcome?${new URLSearchParams({ next })}`);
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const events = await consentEventsFor(db, user.id);
  const gaps = needsConsent(user, events, currentLegal());
  if (gaps.length === 0) redirect(next);

  const askAge = gaps.includes("age");
  const askTerms = gaps.includes("terms") || gaps.includes("privacy");
  const legal = currentLegal();
  // Offered once to anyone who can opt in and hasn't on the current
  // wording; unticked changes nothing.
  const sharing = canOptInToLicensing(user.ageBracket) ? await licensingStatusFor(db, user.id) : null;
  const licensing = askAge
    ? "with-adult-age"
    : sharing && !isLicensingActive(sharing.rows, user.ageBracket, legal.licensing.version)
      ? "always"
      : "never";
  // A document accepted before and now out of date has changed; one never
  // accepted (an account from before consent existed) is asked for fresh.
  const changed = (["terms", "privacy"] as const).filter(
    (d) => gaps.includes(d) && acceptanceMethod(events, d) === "reconsent",
  );
  const intro =
    changed.length === 2
      ? "The Terms and the Privacy policy have changed. Agree to them to carry on using Kinomato."
      : changed[0] === "terms"
        ? "The Terms have changed. Agree to them to carry on using Kinomato."
        : changed[0] === "privacy"
          ? "The Privacy policy has changed. Agree to it to carry on using Kinomato."
          : askTerms
            ? `Kinomato now asks everyone to agree to its Terms and Privacy policy${askAge ? ", and to say how old they are" : ""}.`
            : "Kinomato asks everyone this once.";

  return (
    <PublicShell>
      <main className="p-4" style={{ maxWidth: 440, margin: "0 auto" }}>
        <div className="card" style={{ padding: "20px 18px" }}>
          <p className="eyebrow">Before you carry on</p>
          <h1 className="h-display" style={{ fontSize: 28 }}>
            {askTerms ? "Agree to the current terms" : "One question"}
          </h1>
          <p className="small muted mt-1">{intro}</p>
          {error && (
            <p className="small mt14" role="alert" style={{ color: "var(--warn)" }}>
              {error}
            </p>
          )}
          <form action={submitConsent} className="consent-form stack gap14 mt20">
            <ConsentFields askAge={askAge} askTerms={askTerms} licensing={licensing} age={age} />
            <input type="hidden" name="next" value={next} />
            <button type="submit" className="btn primary">
              Continue
            </button>
          </form>
          <form action={signOut} className="mt14">
            <button type="submit" className="btn ghost">
              Sign out
            </button>
          </form>
        </div>
      </main>
    </PublicShell>
  );
}
