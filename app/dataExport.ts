import { eq, inArray } from "drizzle-orm";
import type { getDb } from "@/db";
import {
  clubs,
  consentEvents,
  constraints,
  dataLicensingConsents,
  films,
  memberships,
  nights,
  nominations,
  ratings,
  ratingTags,
  rsvps,
  tags,
  users,
} from "@/db/schema";
import { ownVotesAndVetoes } from "@/app/clubs/[clubId]/historyRead";
import { ownEmailChanges } from "@/app/emailChange";
import { ownWatchlist } from "@/app/watchlistRead";
import { type DataExport, shapeExport } from "@/lib/dataExport";

type Db = ReturnType<typeof getDb>;

// Download my data (docs/onboarding-spec.md §11.5): one person's own data,
// gathered here and shaped by lib/dataExport.ts. Every query is filtered
// to this user or their own memberships. Nothing here selects another
// person's name, email or vote: pickers, co-members, inviters and other
// raters are never joined. The guarded tables are read through the
// modules that own them: the watchlist (app/watchlistRead.ts), email
// changes (app/emailChange.ts), votes and vetoes (the history-read
// module).
export async function loadDataExport(db: Db, userId: string, now: Date): Promise<DataExport> {
  const [account] = await db
    .select({
      email: users.email,
      displayName: users.displayName,
      createdAt: users.createdAt,
      ageBracket: users.ageBracket,
      ageAttestedAt: users.ageAttestedAt,
    })
    .from(users)
    .where(eq(users.id, userId));

  const own = await db
    .select({
      id: memberships.id,
      name: clubs.name,
      role: memberships.role,
      joinedAt: memberships.joinedAt,
      leftAt: memberships.leftAt,
    })
    .from(memberships)
    .innerJoin(clubs, eq(memberships.clubId, clubs.id))
    .where(eq(memberships.userId, userId));
  const ids = own.map((m) => m.id);
  const mine = <T>(load: () => Promise<T[]>) => (ids.length ? load() : Promise.resolve([] as T[]));

  const [consent, licensing, watchlist, ownRatings, ownNominations, ownRsvps, ownConstraints, choices, emailChanges] =
    await Promise.all([
      db
        .select({
          document: consentEvents.document,
          version: consentEvents.version,
          acceptedAt: consentEvents.acceptedAt,
          method: consentEvents.method,
        })
        .from(consentEvents)
        .where(eq(consentEvents.userId, userId)),
      db
        .select({
          wordingVersion: dataLicensingConsents.wordingVersion,
          optedInAt: dataLicensingConsents.optedInAt,
          withdrawnAt: dataLicensingConsents.withdrawnAt,
        })
        .from(dataLicensingConsents)
        .where(eq(dataLicensingConsents.userId, userId)),
      ownWatchlist(db, userId),
      mine(() =>
        db
          .select({
            id: ratings.id,
            clubName: clubs.name,
            filmTitle: films.title,
            nightAt: nights.scheduledAt,
            scoreQuality: ratings.scoreQuality,
            scoreFun: ratings.scoreFun,
            hotTake: ratings.hotTake,
          })
          .from(ratings)
          .innerJoin(nights, eq(ratings.nightId, nights.id))
          .innerJoin(clubs, eq(nights.clubId, clubs.id))
          .leftJoin(films, eq(nights.winningFilmId, films.id))
          .where(inArray(ratings.membershipId, ids)),
      ),
      mine(() =>
        db
          .select({ clubName: clubs.name, filmTitle: films.title, nightAt: nights.scheduledAt })
          .from(nominations)
          .innerJoin(nights, eq(nominations.nightId, nights.id))
          .innerJoin(clubs, eq(nights.clubId, clubs.id))
          .innerJoin(films, eq(nominations.filmId, films.id))
          .where(inArray(nominations.membershipId, ids)),
      ),
      mine(() =>
        db
          .select({ clubName: clubs.name, nightAt: nights.scheduledAt, status: rsvps.status })
          .from(rsvps)
          .innerJoin(nights, eq(rsvps.nightId, nights.id))
          .innerJoin(clubs, eq(nights.clubId, clubs.id))
          .where(inArray(rsvps.membershipId, ids)),
      ),
      mine(() =>
        db
          .select({
            clubName: clubs.name,
            kind: constraints.kind,
            ruleType: constraints.ruleType,
            value: constraints.value,
            label: constraints.label,
            appliesWhenAbsent: constraints.appliesWhenAbsent,
          })
          .from(constraints)
          .innerJoin(memberships, eq(constraints.membershipId, memberships.id))
          .innerJoin(clubs, eq(memberships.clubId, clubs.id))
          .where(inArray(constraints.membershipId, ids)),
      ),
      ownVotesAndVetoes(db, ids),
      ownEmailChanges(db, userId),
    ]);

  // Your tags on your own ratings: tag display names are the club's, not
  // anyone's identity.
  const ratingIds = ownRatings.map((r) => r.id);
  const tagRows = ratingIds.length
    ? await db
        .select({ ratingId: ratingTags.ratingId, name: tags.displayName })
        .from(ratingTags)
        .innerJoin(tags, eq(ratingTags.tagId, tags.id))
        .where(inArray(ratingTags.ratingId, ratingIds))
    : [];
  const tagsOf = (ratingId: string) => tagRows.filter((t) => t.ratingId === ratingId).map((t) => t.name);

  return shapeExport(
    {
      account,
      consentEvents: consent,
      licensing,
      clubs: own,
      watchlist,
      ratings: ownRatings.map((r) => ({ ...r, tags: tagsOf(r.id) })),
      nominations: ownNominations,
      rsvps: ownRsvps,
      constraints: ownConstraints,
      votes: choices.votes,
      vetoes: choices.vetoes,
      emailChanges,
    },
    now,
  );
}
