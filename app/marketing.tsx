import Link from "next/link";
import { PublicShell } from "@/app/shell";

// The signed-out `/` (docs/onboarding-spec.md §5.2): the pitch, Start a
// club and Sign in, how it works in three steps, and the line about
// ratings. Describes only what's built. No third-party anything: no
// scripts, pixels, analytics, embedded fonts from elsewhere or images.
//
// Phone: one column, pitch → actions → steps. From 900px: pitch and actions
// left, a sample Tonight card right (app/globals.css, .hero).

// Built like app/auth.ts's loginUrl, so it's the same URL a signed-out
// visit to /new redirects to.
const START_HREF = `/login?${new URLSearchParams({ returnTo: "/new" })}`;

const STEPS: { title: string; body: string }[] = [
  {
    title: "Start a club",
    body: "Give it a name, say how often you meet and on which night, in person or remote.",
  },
  {
    title: "Add your people",
    body: "Each person gets their own invite link, made for them and greeting them by name.",
  },
  {
    title: "Take turns picking",
    body: "Whoever picked least recently nominates from their watchlist. The club votes, and the pick locks in.",
  },
];

export function Marketing() {
  return (
    <PublicShell
      topbarEnd={
        <Link href="/login" className="topbar-end">
          Sign in
        </Link>
      }
    >
      <main className="landing">
        <div className="hero">
          <div>
            <h1 className="h-display" style={{ fontSize: 42 }}>
              Whose turn is it?
            </h1>
            <p className="muted" style={{ margin: "12px 0 0", maxWidth: "42ch" }}>
              Kinomato is for friends who have a movie night. Everyone keeps a watchlist, you take
              turns picking, the club votes, the pick locks in, and the club&apos;s history is kept.
            </p>
            <div className="stack gap8 mt20" style={{ maxWidth: 320 }}>
              <Link href={START_HREF} className="btn primary" style={{ textAlign: "center" }}>
                Start a club
              </Link>
              <Link href="/login" className="btn ghost" style={{ textAlign: "center" }}>
                Sign in
              </Link>
            </div>
          </div>
          <SampleTonightCard />
        </div>

        <h2 className="sec mt26">How it works</h2>
        <ol className="steps mt14">
          {STEPS.map((step, i) => (
            <li key={step.title} className="card">
              <p className="eyebrow">{i + 1}</p>
              <div style={{ fontSize: 15 }}>{step.title}</div>
              <p className="small muted" style={{ margin: "6px 0 0" }}>
                {step.body}
              </p>
            </li>
          ))}
        </ol>

        <div className="note mt26">
          <p className="small" style={{ margin: 0 }}>
            Every rating on Kinomato comes from a real person who watched the film with people they
            know.
          </p>
        </div>
      </main>
    </PublicShell>
  );
}

// An illustration, not data: the app's own card classes with clearly
// sample text. Text only — no posters or other TMDB assets. Hidden from
// screen readers apart from a one-line description.
function SampleTonightCard() {
  const nominees: [string, number][] = [
    ["The Thing", 3],
    ["Paddington 2", 1],
    ["Chungking Express", 0],
  ];
  return (
    <figure className="hero-art">
      <figcaption className="sr-only">Example of a club&apos;s Tonight card</figcaption>
      <div className="card" aria-hidden="true" style={{ padding: 16 }}>
        <div className="between" style={{ alignItems: "baseline", gap: 12 }}>
          <span className="h-display" style={{ fontSize: 22 }}>
            Saturday Club
          </span>
          <span className="tiny dim">Sat 8:00pm</span>
        </div>
        <p className="small muted" style={{ margin: "7px 0 0" }}>
          Voting — Sam is picking
        </p>
        <div className="stack gap8 mt14">
          {nominees.map(([title, votes]) => (
            <div key={title} className="nominee">
              <div className="between">
                <span className="small">{title}</span>
                <span className="small" style={{ color: votes ? "var(--accent)" : "var(--dim)" }}>
                  {votes}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </figure>
  );
}
