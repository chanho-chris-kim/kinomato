import Link from "next/link";
import { GlobalShell, PublicShell } from "@/app/shell";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { clubs, memberships } from "@/db/schema";
import { getSessionUserId } from "@/app/session";

// Stopgap until docs/onboarding-spec.md §5.2/§5.7 replace this route.
// This page used to select every row in `clubs` and link each one, to
// anyone. Now: signed out lists nothing; signed in lists only the clubs
// the session's user is an active member of.
export default async function Home() {
  // Per-request by construction: getSessionUserId reads the cookie first.
  const userId = await getSessionUserId();
  const myClubs = userId
    ? await getDb()
        .select({ id: clubs.id, name: clubs.name })
        .from(memberships)
        .innerJoin(clubs, eq(memberships.clubId, clubs.id))
        .where(and(eq(memberships.userId, userId), isNull(memberships.leftAt)))
        .orderBy(asc(clubs.name))
    : [];

  // Signed out: the wordmark-only bar (no global nav without a session).
  // Signed in: the global shell, Clubs current. The content itself is the
  // stopgap until rebuild steps 5b (club cards) and 5d (marketing).
  const content = (
    <>
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
    </>
  );
  if (!userId) {
    return (
      <PublicShell>
        <main className="p-4">{content}</main>
      </PublicShell>
    );
  }
  return <GlobalShell current="clubs">{content}</GlobalShell>;
}
