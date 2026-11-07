import type { Metadata } from "next";
import { LegalPage, PendingSection } from "@/app/legalPage";
import { LEGAL } from "@/lib/legal";

// Draft legal text isn't for search engines.
export const metadata: Metadata = {
  title: "Terms — Kinomato",
  robots: LEGAL.terms.draft ? { index: false, follow: false } : undefined,
};

// Terms (docs/onboarding-spec.md §11.1). Placeholder headings only: no
// legal prose until it's written and reviewed.
export default function TermsPage() {
  return (
    <LegalPage title="Terms" document={LEGAL.terms}>
      <PendingSection title="Using Kinomato" />
      <PendingSection title="Your account" />
      <PendingSection title="What you add" />
      <PendingSection title="Ending your account" />
      <PendingSection title="Changes to these terms" />
      <PendingSection title="Contact">
        <p className="small" style={{ margin: "4px 0 0" }}>
          For now, reply to any Kinomato email.
        </p>
      </PendingSection>
    </LegalPage>
  );
}
