// The legal documents' versions, in one place (docs/onboarding-spec.md
// §11.1). A version is a date. The owner decides when it changes — a typo
// fix doesn't — and any change blocks every signed-in page until it's
// re-accepted (app/consent.ts, through app/auth.ts's gates). `draft` stays
// true until a lawyer has signed off the text; the reviewed text arrives
// as a new version, so everyone re-accepts it. No public sign-ups before
// then.

export interface LegalDocument {
  version: string;
  draft: boolean;
}

// The data-licensing opt-in (§11.2): a separate checkbox, never bundled
// into the Terms, default unchecked, 18 or older only. Its wording is
// versioned like the documents: an opt-in counts only for the wording it
// was given against (lib/consent.ts isLicensingActive).
export interface LicensingWording {
  version: string;
  text: string;
}

export interface Legal {
  terms: LegalDocument;
  privacy: LegalDocument;
  licensing: LicensingWording;
}

export const LEGAL: Legal = {
  terms: { version: "2026-11-06", draft: true },
  privacy: { version: "2026-11-06", draft: true },
  licensing: {
    version: "2026-11-06",
    text:
      "Include my ratings, my watchlist additions and what my clubs pick in anonymous aggregates " +
      "Kinomato may share with the film industry, never anything that identifies me. " +
      "I can withdraw in Settings at any time. Withdrawing applies from then on: it can't recall " +
      "aggregates already made.",
  },
};

// What the running app enforces: LEGAL, except that E2E's second server
// (playwright.config.ts) bumps the Terms version to prove a bump sends
// every signed-in account back through /consent. Test-only; nothing sets
// it on the Worker.
export function currentLegal(): Legal {
  const bumpedTerms = process.env.KINOMATO_TEST_TERMS_VERSION;
  if (!bumpedTerms) return LEGAL;
  return { ...LEGAL, terms: { ...LEGAL.terms, version: bumpedTerms } };
}
