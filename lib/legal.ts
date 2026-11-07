// The legal documents' versions, in one place (docs/onboarding-spec.md
// §11.1). A version is a date. The owner decides when it changes — a typo
// fix doesn't — and any change will block every signed-in page until it's
// re-accepted (launch-foundations step (b)). `draft` stays true until a
// lawyer has signed off the text; the reviewed text arrives as a new
// version, so everyone re-accepts it. No public sign-ups before then.

export interface LegalDocument {
  version: string;
  draft: boolean;
}

export const LEGAL: { terms: LegalDocument; privacy: LegalDocument } = {
  terms: { version: "2026-11-06", draft: true },
  privacy: { version: "2026-11-06", draft: true },
};
