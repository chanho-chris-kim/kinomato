import type { Metadata } from "next";
import Link from "next/link";
import { GlobalShell } from "@/app/shell";
import { getDb } from "@/db";
import { getSessionUserId } from "@/app/session";
import { requireUser } from "@/app/auth";
import { loadClubCards } from "@/app/clubCards";
import { Marketing } from "@/app/marketing";
import { DEFAULT_TITLE } from "@/app/metadata";

// The marketing page's title and description (plain meta tags; the
// invite preview image is rebuild step 5e). Signed in, `/` is the Clubs
// screen and keeps the layout's defaults.
export async function generateMetadata(): Promise<Metadata> {
  if (await getSessionUserId()) return {};
  // The description is the site-wide default (app/metadata.ts).
  return { title: DEFAULT_TITLE };
}

// `/`. Signed in: the Clubs screen (docs/onboarding-spec.md §5.7) — a
// greeting and one Ruling A card per active membership. Signed out: the
// marketing page (§5.2, app/marketing.tsx).
export default async function Home() {
  // Per-request by construction: getSessionUserId reads the cookie first.
  const userId = await getSessionUserId();
  if (!userId) return <Marketing />;

  // Signed in, through the same gate as every signed-in page: current
  // consent and an age, or off to /consent or /welcome (app/auth.ts).
  const user = await requireUser("/");
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  // react-hooks/purity targets client components the React Compiler might
  // memoize; this Server Component runs once per request.
  // eslint-disable-next-line react-hooks/purity
  const now = new Date(Date.now());
  const cards = await loadClubCards(db, user.id, now);
  // "Chris K." → "Chris". An account always has a name past /welcome.
  const firstName = user.displayName?.split(" ")[0];

  return (
    <GlobalShell current="clubs">
      <h1 className="h-display mt14" style={{ fontSize: 24 }}>
        {firstName ? `Hi, ${firstName}` : "Hi"}
      </h1>

      {cards.length === 0 ? (
        <>
          <div className="empty mt20">
            <p style={{ margin: "0 0 14px", color: "var(--fg)", fontSize: 15 }}>
              You&apos;re not in a club yet.
            </p>
            <Link href="/new" className="btn primary" style={{ display: "block" }}>
              Start a club
            </Link>
          </div>
          <p className="tiny dim mt14">
            Waiting to join a friend&apos;s club? Ask them for your own invite link, since each
            link is made for one person.
          </p>
        </>
      ) : (
        <>
          <ul className="stack gap8" style={{ listStyle: "none", margin: "20px 0 0", padding: 0 }}>
            {cards.map((card) => (
              <li key={card.clubId}>
                <Link href={`/clubs/${card.clubId}`} className="card clubcard">
                  <div className="between" style={{ alignItems: "baseline", gap: 12 }}>
                    <span className="h-display" style={{ fontSize: 19 }}>
                      {card.name}
                    </span>
                    <span className="tiny dim" style={{ whiteSpace: "nowrap" }}>
                      {card.nextNight}
                    </span>
                  </div>
                  <div className="row gap8" style={{ marginTop: 7 }}>
                    {card.action && <span className="dot" aria-hidden="true" />}
                    <span
                      className={`small status ${card.action ? "action" : "muted"}`}
                    >
                      {/* Never colour alone: the dot is decorative, this is
                          what a screen reader hears. */}
                      {card.action && <span className="sr-only">Needs you: </span>}
                      {card.status}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/new" className="btn mt14" style={{ display: "block", textAlign: "center" }}>
            Start a club
          </Link>
        </>
      )}
    </GlobalShell>
  );
}
