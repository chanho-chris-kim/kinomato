import { and, eq, inArray } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { clubs, films, memberships, nights, nominations, rsvps, votes } from "@/db/schema";
import { getNextPicker, type RotationMembership, type RotationNight } from "@/lib/rotation";
import { castVote, clearIdentity, pickIdentity, setRsvp } from "./actions";

function identityCookieName(clubId: string) {
  return `kinomato_identity_${clubId}`;
}

export default async function ClubPage({
  params,
}: {
  params: Promise<{ clubId: string }>;
}) {
  const { clubId } = await params;
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

  const cookieStore = await cookies();
  const identityMembershipId = cookieStore.get(identityCookieName(clubId))?.value ?? null;
  const currentMembership =
    activeMemberships.find((m) => m.id === identityMembershipId) ?? null;

  // No auth in v0 — a name picker is the whole identity flow.
  if (!currentMembership) {
    return (
      <main className="p-4">
        <h1 className="text-xl font-bold">{club.name}</h1>
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

  const clubNights = await db.select().from(nights).where(eq(nights.clubId, clubId));

  const rotationMemberships: RotationMembership[] = clubMemberships.map((m) => ({
    id: m.id,
    identityKey: m.identityKey,
    clubId: m.clubId,
    joinedAt: m.joinedAt,
    leftAt: m.leftAt,
    postponedAt: m.postponedAt,
  }));
  const rotationNights: RotationNight[] = clubNights.map((n) => ({
    pickerMembershipId: n.pickerMembershipId,
    state: n.state,
    scheduledAt: n.scheduledAt,
  }));
  const whoseTurnResult = getNextPicker({
    memberships: rotationMemberships,
    nights: rotationNights,
    clubPausedAt: club.pausedAt,
  });
  const whoseTurn = whoseTurnResult
    ? clubMemberships.find((m) => m.id === whoseTurnResult.id)
    : null;

  const openNight = clubNights.find((n) => n.state === "open") ?? null;

  let pickerName: string | null = null;
  let nomineeRows: {
    nominationId: string;
    filmTitle: string;
    filmYear: number;
    voteCount: number;
    votedByMe: boolean;
  }[] = [];
  let myRsvpStatus: "yes" | "no" | null = null;

  if (openNight) {
    pickerName =
      clubMemberships.find((m) => m.id === openNight.pickerMembershipId)?.displayName ??
      "someone who's left";

    const nightNominations = await db
      .select({
        nominationId: nominations.id,
        filmTitle: films.title,
        filmYear: films.year,
      })
      .from(nominations)
      .innerJoin(films, eq(nominations.filmId, films.id))
      .where(eq(nominations.nightId, openNight.id));

    const nominationIds = nightNominations.map((n) => n.nominationId);
    const nightVotes = nominationIds.length
      ? await db.select().from(votes).where(inArray(votes.nominationId, nominationIds))
      : [];

    nomineeRows = nightNominations.map((n) => ({
      nominationId: n.nominationId,
      filmTitle: n.filmTitle,
      filmYear: n.filmYear,
      voteCount: nightVotes.filter((v) => v.nominationId === n.nominationId).length,
      votedByMe: nightVotes.some(
        (v) => v.nominationId === n.nominationId && v.membershipId === currentMembership.id,
      ),
    }));

    const [myRsvp] = await db
      .select()
      .from(rsvps)
      .where(
        and(eq(rsvps.nightId, openNight.id), eq(rsvps.membershipId, currentMembership.id)),
      );
    myRsvpStatus = myRsvp?.status ?? null;
  }

  return (
    <main className="p-4">
      <h1 className="text-xl font-bold">{club.name}</h1>
      <p className="mt-1">
        You are: {currentMembership.displayName}{" "}
        <form
          action={clearIdentity.bind(null, clubId)}
          className="inline"
        >
          <button type="submit" className="underline">
            (switch)
          </button>
        </form>
      </p>

      <h2 className="mt-4 font-semibold">Whose turn</h2>
      <p>{whoseTurn ? whoseTurn.displayName : "Nobody active in this club."}</p>

      {!openNight && <p className="mt-4">No open vote right now.</p>}

      {openNight && (
        <>
          <h2 className="mt-4 font-semibold">
            This week&apos;s pick, nominated by {pickerName}
          </h2>

          <h3 className="mt-4 font-semibold">RSVP</h3>
          <p className="mt-1">
            Current answer: {myRsvpStatus ?? "no answer yet"}
          </p>
          <div className="mt-1 flex gap-2">
            <form action={setRsvp.bind(null, clubId, openNight.id, "yes")}>
              <button
                type="submit"
                className={`border px-3 py-1 ${myRsvpStatus === "yes" ? "bg-gray-200" : ""}`}
              >
                Going
              </button>
            </form>
            <form action={setRsvp.bind(null, clubId, openNight.id, "no")}>
              <button
                type="submit"
                className={`border px-3 py-1 ${myRsvpStatus === "no" ? "bg-gray-200" : ""}`}
              >
                Not going
              </button>
            </form>
          </div>

          <h3 className="mt-4 font-semibold">Nominees</h3>
          <ul className="mt-1 space-y-2">
            {nomineeRows.map((n) => (
              <li key={n.nominationId} className="border p-2">
                <div>
                  {n.filmTitle} ({n.filmYear}) — {n.voteCount}{" "}
                  {n.voteCount === 1 ? "vote" : "votes"}
                  {n.votedByMe && " — your vote"}
                </div>
                <form action={castVote.bind(null, clubId, n.nominationId)}>
                  <button type="submit" className="mt-1 border px-3 py-1">
                    {n.votedByMe ? "Voted" : "Vote"}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
