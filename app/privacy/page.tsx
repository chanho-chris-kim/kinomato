import type { Metadata } from "next";
import { LegalPage, PendingSection } from "@/app/legalPage";
import { currentLegal, LEGAL } from "@/lib/legal";
import { FORM_ECHO_COOKIE } from "@/app/formEcho";
import { SESSION_COOKIE_NAME } from "@/app/session";
import { SIGN_IN_EMAIL_COOKIE } from "@/app/signInCookie";
import { SEEN_FROM_COOKIE } from "@/app/watchlist/seenFromCookie";

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

// Facts about what's kept, not legal prose (that's pending review).
const COLLECTED = [
  "Limits and preferences you set in a club, seen only by you, and applied without showing anyone why.",
];

// Every cookie Kinomato sets, all first-party and functional (§11.6: no
// cookie banner for now). Names come from the modules that set them, so
// the list can't drift. Facts, not legal prose.
const COOKIES: { name: string; role: string }[] = [
  { name: SESSION_COOKIE_NAME, role: "keeps you signed in" },
  { name: SEEN_FROM_COOKIE, role: "remembers which club your Watchlist is seen from" },
  { name: SIGN_IN_EMAIL_COOKIE, role: "holds the address you're signing in with, for 15 minutes" },
  {
    name: FORM_ECHO_COOKIE,
    role: "holds what you typed into a form for a minute, so it's still there if something needs fixing",
  },
];

// Privacy (docs/onboarding-spec.md §11.1). Placeholder headings only: no
// legal prose until it's written and reviewed. The processor and cookie
// lists are factual.
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" document={currentLegal().privacy}>
      <PendingSection title="What we collect">
        <ul className="small mt14 collected" style={{ paddingLeft: 18, margin: "10px 0 0" }}>
          {COLLECTED.map((fact) => (
            <li key={fact} style={{ marginTop: 4 }}>
              {fact}
            </li>
          ))}
        </ul>
      </PendingSection>
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
      <PendingSection title="Cookies">
        <ul className="small mt14 cookies" style={{ paddingLeft: 18, margin: "10px 0 0" }}>
          {COOKIES.map((c) => (
            <li key={c.name} style={{ marginTop: 4 }}>
              <code>{c.name}</code>: {c.role}.
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
