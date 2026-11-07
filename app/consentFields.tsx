import Link from "next/link";
import { currentLegal } from "@/lib/legal";

// The consent controls, shared by /welcome (with the name above them) and
// /consent (docs/onboarding-spec.md §11.1–§11.3). Inside a <form
// className="consent-form">. No JavaScript: the data-sharing box, when it
// depends on the age, is shown by CSS only while "18 or older" is chosen
// (app/globals.css), and the server drops a 13–17 opt-in whatever is sent
// (app/consent.ts recordConsent).
export function ConsentFields({
  askAge,
  askTerms,
  licensing,
  age,
}: {
  askAge: boolean;
  askTerms: boolean;
  // "with-adult-age": offered once "18 or older" is chosen (the age is
  // being asked); "always": the account is already 18 or older; "never".
  licensing: "with-adult-age" | "always" | "never";
  // The age picked before a validation error sent the form back.
  age?: string;
}) {
  const legal = currentLegal();
  return (
    <>
      {askAge && (
        <fieldset className="consent-age">
          <legend className="small muted">How old are you?</legend>
          {(
            [
              ["13_17", "13–17"],
              ["18_plus", "18 or older"],
              ["under_13", "Under 13"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="consent-choice">
              <input type="radio" name="age" value={value} required defaultChecked={age === value} />
              {label}
            </label>
          ))}
        </fieldset>
      )}

      {askTerms && (
        <label className="consent-choice consent-terms">
          {/* Not `required`: "Under 13" must submit without it, and only the
              server can tell (lib/consent.ts readConsentForm, which refuses
              anything else without the box). */}
          <input type="checkbox" name="terms" />
          <span>
            I agree to the{" "}
            <Link href="/terms" target="_blank">
              Terms
            </Link>{" "}
            (version {legal.terms.version}) and the{" "}
            <Link href="/privacy" target="_blank">
              Privacy policy
            </Link>{" "}
            (version {legal.privacy.version}).
          </span>
        </label>
      )}

      {licensing !== "never" && (
        <div className="licensing-optin" data-when={licensing === "with-adult-age" ? "adult" : "always"}>
          <label className="consent-choice">
            <input type="checkbox" name="licensing" />
            <span>
              <span className="consent-optional">Optional. </span>
              {legal.licensing.text}
            </span>
          </label>
        </div>
      )}
    </>
  );
}
