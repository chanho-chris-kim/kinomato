import Link from "next/link";
import type { ReactNode } from "react";
import { describeSchedule } from "@/lib/format";

// The app's two shells (docs/onboarding-spec.md §5.11, Ruling D), styled
// from docs/prototype.html — breakpoints are app/globals.css's container
// queries on .app.
//
// - GlobalShell: every signed-in screen. Global nav (Clubs, Watchlist,
//   Settings) in a fixed bottom tab bar on phones and in a sticky top bar
//   from 620px, never a sidebar; the content column is capped from 900px;
//   club pages add a rail of real data from 1120px.
// - PublicShell: signed-out screens — a slim bar with only the wordmark,
//   no global nav (every destination in it needs a session).

export type GlobalSection = "clubs" | "watchlist" | "settings";

const SECTIONS: { key: GlobalSection; href: string; label: string }[] = [
  { key: "clubs", href: "/", label: "Clubs" },
  { key: "watchlist", href: "/watchlist", label: "Watchlist" },
  { key: "settings", href: "/settings", label: "Settings" },
];

// Top left on every screen, linking to / — the marketing page signed out,
// the club list signed in (§5.11.1). Text in the theme's display face.
export function Wordmark() {
  return (
    <Link href="/" className="wordmark">
      Kinomato
    </Link>
  );
}

export function PublicShell({
  topbarEnd,
  children,
}: {
  // Right end of the bar. Only the marketing page uses it, for Sign in
  // (§5.11.2); never the global nav.
  topbarEnd?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="app">
      <header className="topbar">
        <Wordmark />
        {topbarEnd}
      </header>
      {children}
    </div>
  );
}

export function GlobalShell({
  current,
  header,
  rail,
  reserveRail = false,
  children,
}: {
  // null: no global section is current (the legal pages, signed in).
  current: GlobalSection | null;
  // Above the page's own content, inside the capped column (ClubHeader).
  header?: ReactNode;
  // Club pages only, and only real data (CLAUDE.md theming ruling).
  rail?: ReactNode;
  // Keep the rail's space with nothing in it: a club tab with no rail of
  // its own (Members), so switching tabs doesn't move or resize the main
  // column. Empty, not a landmark: there's no content to announce.
  reserveRail?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="app">
      <header className="topbar">
        <Wordmark />
        <nav className="topnav" aria-label="Main">
          {SECTIONS.map((s) => (
            <Link
              key={s.key}
              href={s.href}
              className={s.key === "settings" ? "end" : undefined}
              aria-current={s.key === current ? "page" : undefined}
            >
              {s.label}
            </Link>
          ))}
        </nav>
      </header>
      <div className="body">
        <main className="main">
          {header}
          {children}
        </main>
        {rail ? (
          <aside className="rail" aria-label="Club context">
            {rail}
          </aside>
        ) : (
          reserveRail && <div className="rail" aria-hidden="true" />
        )}
      </div>
      <nav className="tabbar" aria-label="Main">
        {SECTIONS.map((s) => (
          <Link key={s.key} href={s.href} aria-current={s.key === current ? "page" : undefined}>
            <TabIcon name={s.key} />
            {s.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

// Club name and schedule line (§5.10). No back chevron: the wordmark and
// Clubs both go to the list (§5.11.2). The name links to the club's own
// page, which is how the watchlist and tag pages get back to it.
export function ClubHeader({
  club,
}: {
  club: {
    id: string;
    name: string;
    cadence: "weekly" | "biweekly" | "monthly" | "ad_hoc";
    defaultDay: number | null;
    defaultTime: string | null;
    mode: "in_person" | "remote";
  };
}) {
  return (
    <>
      <h1 className="h-display" style={{ fontSize: 22 }}>
        <Link href={`/clubs/${club.id}`}>{club.name}</Link>
      </h1>
      <p className="small muted" style={{ margin: "4px 0 0" }}>
        {describeSchedule(club)}
      </p>
    </>
  );
}

function TabIcon({ name }: { name: GlobalSection }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {name === "clubs" && (
        <>
          <circle cx="9" cy="8" r="3" />
          <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
          <path d="M16 6.5a3 3 0 0 1 0 5.8M21 20c0-2.6-1.5-4.6-3.7-5.5" />
        </>
      )}
      {name === "watchlist" && <path d="M4 4h6v8H4zM14 4h6v8h-6zM4 16h6v4H4zM14 16h6v4h-6z" />}
      {name === "settings" && (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
        </>
      )}
    </svg>
  );
}

export type ClubTab = "tonight" | "history" | "members";

// Club-level tabs under the club header (§5.10–5.11.2): Tonight · History ·
// Members, the same at every width. `current` is null on a club page that
// isn't one of the tabs.
export function ClubTabs({ clubId, current }: { clubId: string; current: ClubTab | null }) {
  const tabs: { key: ClubTab; href: string; label: string }[] = [
    { key: "tonight", href: `/clubs/${clubId}`, label: "Tonight" },
    { key: "history", href: `/clubs/${clubId}/history`, label: "History" },
    { key: "members", href: `/clubs/${clubId}/members`, label: "Members" },
  ];
  return (
    <div className="ctabs">
      <nav className="segc" aria-label="Club">
        {tabs.map((t) => (
          <Link key={t.key} href={t.href} aria-current={t.key === current ? "page" : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
