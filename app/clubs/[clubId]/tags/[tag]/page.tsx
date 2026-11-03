import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { clubs, films, nights, ratings, ratingTags, rsvps, tags } from "@/db/schema";
import { areTakesRevealed } from "@/lib/ratingReveal";
import { AppShell } from "../../AppShell";
import { requireClubMember } from "@/app/auth";
import { Poster } from "../../Poster";

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

  // Signed in and an active member, or /login / 404 (docs/onboarding-spec.md §5.1).
  await requireClubMember(clubId, `/clubs/${clubId}/tags/${tagName}`);
  const [club] = await db.select().from(clubs).where(eq(clubs.id, clubId));

  const [tagRow] = await db
    .select()
    .from(tags)
    .where(and(eq(tags.clubId, clubId), eq(tags.name, tagName)));

  const taggedFilms: { title: string; year: number; posterPath: string | null }[] = [];

  if (tagRow) {
    const rows = await db
      .select({
        nightId: ratings.nightId,
        filmId: nights.winningFilmId,
        filmTitle: films.title,
        filmYear: films.year,
        posterPath: films.posterPath,
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
      taggedFilms.push({ title: row.filmTitle, year: row.filmYear, posterPath: row.posterPath });
    }
  }

  return (
    <AppShell clubId={clubId} clubName={club.name} current="tags">
      <h2 className="h-display mt14" style={{ fontSize: 22 }}>
        Tagged &quot;{tagRow?.displayName ?? tagName}&quot;
      </h2>
      {taggedFilms.length === 0 ? (
        <div className="empty mt20">Nothing tagged this way yet.</div>
      ) : (
        <div className="grid3 mt20">
          {taggedFilms.map((f, i) => (
            <div key={i} className="watchlist-item">
              <div className="poster">
                <Poster posterPath={f.posterPath} title={f.title} size={185} />
              </div>
              <div className="tiny">
                {f.title} <span className="dim">({f.year})</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
