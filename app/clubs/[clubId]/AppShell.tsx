import Link from "next/link";
import type { ReactNode } from "react";

// Shared shell for every club-scoped page (club home, watchlist, tag
// page) — bottom tab bar on phones, an icon sidebar from 620px, a
// labeled sidebar from 900px, and an optional context rail from 1120px
// (docs/prototype.html's ".late show" responsive system, container
// queries defined in globals.css). Only two real nav destinations exist
// — Club and Watchlist — unlike the prototype's five fake tabs
// (Tonight/List/Club/History/You); the tag page has no nav entry of
// its own, reached only via a tag link on a revealed rating.
//
// The current-page-is-plain-text / other-page-is-a-link pattern here
// is unchanged from the old ClubNav (e2e/nav.spec.ts depends on it) —
// only the visual chrome (icons, responsive placement) is new.
export function AppShell({
  clubId,
  clubName,
  current,
  rail,
  children,
}: {
  clubId: string;
  clubName: string;
  current: "club" | "watchlist" | "tags";
  rail?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="app">
      <div className="shell">
        <nav className="nav" aria-label="Main">
          {current === "club" ? (
            <span className="navcurrent" aria-current="page">
              <NavIcon name="club" />
              Club
            </span>
          ) : (
            <Link href={`/clubs/${clubId}`}>
              <NavIcon name="club" />
              Club
            </Link>
          )}
          {current === "watchlist" ? (
            <span className="navcurrent" aria-current="page">
              <NavIcon name="list" />
              Watchlist
            </span>
          ) : (
            <Link href={`/clubs/${clubId}/list`}>
              <NavIcon name="list" />
              Watchlist
            </Link>
          )}
        </nav>
        <div className="body">
          <main className="main">
            <h1 className="h-display" style={{ fontSize: 18 }}>
              <Link href={`/clubs/${clubId}`}>{clubName}</Link>
            </h1>
            {children}
          </main>
          {rail && (
            <aside className="rail" aria-label="Club context">
              {rail}
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

function NavIcon({ name }: { name: "club" | "list" }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {name === "club" ? (
        <>
          <circle cx="9" cy="8" r="3" />
          <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
          <path d="M16 6.5a3 3 0 0 1 0 5.8M21 20c0-2.6-1.5-4.6-3.7-5.5" />
        </>
      ) : (
        <path d="M4 4h6v8H4zM14 4h6v8h-6zM4 16h6v4H4zM14 16h6v4h-6z" />
      )}
    </svg>
  );
}
