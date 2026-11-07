import type { Metadata } from "next";
import { LegalPage, PendingSection } from "@/app/legalPage";
import { LEGAL } from "@/lib/legal";

// Draft legal text isn't for search engines.
export const metadata: Metadata = {
  title: "Privacy — Kinomato",
  robots: LEGAL.privacy.draft ? { index: false, follow: false } : undefined,
};

// The services that process data for Kinomato (docs/onboarding-spec.md §9).
// Facts, not legal prose.
const PROCESSORS: { name: string; role: string }[] = [
  { name: "Brevo (France)", role: "email delivery: your email address and the emails we send you" },
  { name: "Neon", role: "the database" },
  { name: "Cloudflare", role: "hosting; it sees every request and stores request logs" },
  {
    name: "TMDB",
    role: "film data; it receives film lookups and the search text you type, never linked to you",
  },
];

// Privacy (docs/onboarding-spec.md §11.1). Placeholder headings only: no
// legal prose until it's written and reviewed. The processor list is
// factual.
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" document={LEGAL.privacy}>
      <PendingSection title="What we collect" />
      <PendingSection title="How we use it" />
      <PendingSection title="Who we share it with">
        <ul className="small mt14 processors" style={{ paddingLeft: 18, margin: "10px 0 0" }}>
          {PROCESSORS.map((p) => (
            <li key={p.name} style={{ marginTop: 4 }}>
              <strong>{p.name}</strong>: {p.role}.
            </li>
          ))}
        </ul>
      </PendingSection>
      <PendingSection title="How long we keep it" />
      <PendingSection title="Your choices" />
      <PendingSection title="Contact">
        <p className="small" style={{ margin: "4px 0 0" }}>
          For now, reply to any Kinomato email.
        </p>
      </PendingSection>
    </LegalPage>
  );
}
