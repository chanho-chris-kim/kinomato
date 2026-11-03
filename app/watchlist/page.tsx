import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { clubs, memberships } from "@/db/schema";
import { requireUser } from "@/app/auth";
import { GlobalShell } from "@/app/shell";

// Temporary (rebuild step 5a): watchlists are still per membership, so the
// global Watchlist entry routes to the club-scoped list. Step 6 makes the
// watchlist global and replaces this page (docs/onboarding-spec.md §6).
// One active club → straight to its list; several → one link per club;
// none → a plain explanation, never a "coming soon".
export default async function WatchlistPage() {
  const user = await requireUser("/watchlist");
  const myClubs = await getDb()
    .select({ id: clubs.id, name: clubs.name })
    .from(memberships)
    .innerJoin(clubs, eq(memberships.clubId, clubs.id))
    .where(and(eq(memberships.userId, user.id), isNull(memberships.leftAt)))
    .orderBy(asc(clubs.name));

  if (myClubs.length === 1) redirect(`/clubs/${myClubs[0].id}/list`);

  return (
    <GlobalShell current="watchlist">
      <h1 className="h-display" style={{ fontSize: 22 }}>
        Watchlist
      </h1>
      {myClubs.length === 0 ? (
        <div className="empty mt20">
          <p style={{ margin: "0 0 14px" }}>
            Your watchlist lives in your clubs for now. Start a club, or join one with the invite
            link a friend sends you.
          </p>
          <Link href="/new" className="btn primary" style={{ display: "block", textAlign: "center" }}>
            Start a club
          </Link>
        </div>
      ) : (
        <ul className="stack gap8 mt20" style={{ listStyle: "none", padding: 0, margin: "20px 0 0" }}>
          {myClubs.map((c) => (
            <li key={c.id}>
              <Link href={`/clubs/${c.id}/list`} className="card" style={{ display: "block" }}>
                {c.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </GlobalShell>
  );
}
