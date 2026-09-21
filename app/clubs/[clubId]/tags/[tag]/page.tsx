import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { clubs, films, memberships, nights, ratings, ratingTags, rsvps, tags } from "@/db/schema";
import { areTakesRevealed } from "@/lib/ratingReveal";
import { pickIdentity } from "../../actions";
import { ClubNav } from "../../ClubNav";
import { getIdentityMembershipId } from "../../identity";

// Club-scoped only (CLAUDE.md) — no cross-club or global tag
// aggregation. `tag` in the URL is the normalized name (lib/tags.ts),
// not the display casing, since that's the stable, collision-free
// lookup key; the page still shows the club's first-seen display
// casing once it resolves the row.
export default async function TagPage({
  params,
}: {
  params: Promise<{ clubId: string; tag: string }>;
}) {
  const { clubId, tag: tagName } = await params;
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts

  const [club] = await db.select().from(clubs).where(eq(clubs.id, clubId));
  if (!club) {
    return <main className="p-4">Club not found.</main>;
  }

  const clubMemberships = await db
    .select()
    .from(memberships)
    .where(eq(memberships.clubId, clubId));
  const activeMemberships = clubMemberships.filter((m) => m.leftAt === null);

  const identityMembershipId = await getIdentityMembershipId(clubId);
  const currentMembership =
    activeMemberships.find((m) => m.id === identityMembershipId) ?? null;

  // No auth in v0 — a name picker is the whole identity flow, shared with
  // every other club-scoped page.
  if (!currentMembership) {
    return (
      <main className="p-4">
        <ClubNav clubId={clubId} clubName={club.name} current="tags" />
        <p className="mt-2">Who are you?</p>
        <ul className="mt-2 space-y-2">
          {activeMemberships.map((m) => (
            <li key={m.id}>
              <form action={pickIdentity.bind(null, clubId, m.id)}>
                <button type="submit" className="border px-3 py-1">
                  {m.displayName}
                </button>
              </form>
            </li>
          ))}
        </ul>
      </main>
    );
  }

  const [tagRow] = await db
    .select()
    .from(tags)
    .where(and(eq(tags.clubId, clubId), eq(tags.name, tagName)));

  const taggedFilms: { title: string; year: number }[] = [];

  if (tagRow) {
    const rows = await db
      .select({
        nightId: ratings.nightId,
        filmId: nights.winningFilmId,
        filmTitle: films.title,
        filmYear: films.year,
      })
      .from(ratingTags)
      .innerJoin(ratings, eq(ratingTags.ratingId, ratings.id))
      .innerJoin(nights, eq(ratings.nightId, nights.id))
      .innerJoin(films, eq(nights.winningFilmId, films.id))
      .where(eq(ratingTags.tagId, tagRow.id));

    // Blind reveal extends to tags (CLAUDE.md: "show tags with the
    // revealed ratings") — a tag only surfaces here once its night's
    // ratings are fully revealed, the same rule the club page applies
    // to the ratings list itself.
    const nightIds = Array.from(new Set(rows.map((r) => r.nightId)));
    const revealedNightIds = new Set<string>();
    for (const nightId of nightIds) {
      const nightRsvps = await db.select().from(rsvps).where(eq(rsvps.nightId, nightId));
      const attendingMembershipIds = nightRsvps
        .filter((r) => r.status === "yes")
        .map((r) => r.membershipId);
      const nightRatings = await db
        .select({ membershipId: ratings.membershipId })
        .from(ratings)
        .where(eq(ratings.nightId, nightId));
      const ratedMembershipIds = nightRatings.map((r) => r.membershipId);
      if (areTakesRevealed(attendingMembershipIds, ratedMembershipIds)) {
        revealedNightIds.add(nightId);
      }
    }

    const revealedRows = rows.filter((r) => revealedNightIds.has(r.nightId));
    const seenFilmIds = new Set<string>();
    for (const row of revealedRows) {
      if (row.filmId === null || seenFilmIds.has(row.filmId)) continue;
      seenFilmIds.add(row.filmId);
      taggedFilms.push({ title: row.filmTitle, year: row.filmYear });
    }
  }

  return (
    <main className="p-4">
      <ClubNav clubId={clubId} clubName={club.name} current="tags" />
      <h2 className="font-semibold">
        Tagged &quot;{tagRow?.displayName ?? tagName}&quot;
      </h2>
      {taggedFilms.length === 0 ? (
        <p className="mt-1">Nothing tagged this way yet.</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {taggedFilms.map((f, i) => (
            <li key={i}>
              {f.title} ({f.year})
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
