import Link from "next/link";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { clubs, memberships } from "@/db/schema";
import { getSessionUserId } from "@/app/session";

// Per-request: depends on the session cookie.
export const dynamic = "force-dynamic";

// Stopgap until docs/onboarding-spec.md §5.2/§5.7 replace this route.
// This page used to select every row in `clubs` and link each one, to
// anyone. Now: signed out lists nothing; signed in lists only the clubs
// the session's user is an active member of. A guest with only a
// per-club identity cookie has no session and sees no list — they reach
// their club by its URL, as before.
export default async function Home() {
  const db = getDb();
  const userId = await getSessionUserId(db);
  const myClubs = userId
    ? await db
        .select({ id: clubs.id, name: clubs.name })
        .from(memberships)
        .innerJoin(clubs, eq(memberships.clubId, clubs.id))
        .where(and(eq(memberships.userId, userId), isNull(memberships.leftAt)))
        .orderBy(asc(clubs.name))
    : [];

  return (
    <main className="p-4">
      <h1 className="text-xl font-bold">kinomato</h1>
      <p className="mt-2">
        <Link href="/new" className="underline">
          Start a club
        </Link>
      </p>
      {!userId ? (
        <p className="mt-2">
          <Link href="/login" className="underline">
            Sign in
          </Link>{" "}
          to see your clubs.
        </p>
      ) : myClubs.length === 0 ? (
        <p className="mt-2">You&apos;re not in any clubs yet.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {myClubs.map((c) => (
            <li key={c.id}>
              <Link href={`/clubs/${c.id}`} className="underline">
                {c.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
