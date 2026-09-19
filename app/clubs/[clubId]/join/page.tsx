import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { clubs, memberships, nights } from "@/db/schema";
import { getIdentityMembershipId } from "../identity";
import { claimExistingName, joinAsNewMember } from "./actions";

// analysis-v1.md §1.1 stage 3: "sees the club already populated with
// the founder's name and the first scheduled night, picks their name,
// and they're in." The invite link renders the actual club — name,
// night, members already in — not a generic marketing card (§7.1).
export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ clubId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { clubId } = await params;
  const { error } = await searchParams;
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts

  const [club] = await db.select().from(clubs).where(eq(clubs.id, clubId));
  if (!club) {
    return <main className="p-4">This invite link doesn&apos;t match a club.</main>;
  }

  // Already have an identity here — nothing left to join.
  const existingMembershipId = await getIdentityMembershipId(clubId);
  if (existingMembershipId) {
    redirect(`/clubs/${clubId}`);
  }

  const clubMemberships = await db
    .select()
    .from(memberships)
    .where(eq(memberships.clubId, clubId));
  const activeMemberships = clubMemberships.filter((m) => m.leftAt === null);

  const clubNights = await db.select().from(nights).where(eq(nights.clubId, clubId));
  const upcomingNight =
    clubNights.find((n) => n.state === "draft" || n.state === "open" || n.state === "locked") ??
    null;

  return (
    <main className="p-4">
      <h1 className="text-xl font-bold">{club.name}</h1>
      <p className="mt-1">
        {club.cadence.replace("_", " ")} · {club.mode === "in_person" ? "In person" : "Remote"}
      </p>
      <p className="mt-1">
        {upcomingNight
          ? `Next night: ${upcomingNight.scheduledAt.toLocaleString()}`
          : "No night scheduled yet."}
      </p>

      {error && <p className="mt-2 text-red-700">{error}</p>}

      <h2 className="mt-4 font-semibold">Who&apos;s in</h2>
      <p className="mt-1">
        {activeMemberships.map((m) => m.displayName).join(", ")}
      </p>

      <h2 className="mt-4 font-semibold">Who are you?</h2>
      <p className="mt-1">Pick your name if it&apos;s already listed:</p>
      <ul className="mt-1 space-y-2">
        {activeMemberships.map((m) => (
          <li key={m.id}>
            <form action={claimExistingName.bind(null, clubId, m.id)}>
              <button type="submit" className="border px-3 py-1">
                {m.displayName}
              </button>
            </form>
          </li>
        ))}
      </ul>

      <p className="mt-4">Not listed? Add yourself:</p>
      <p className="text-sm">This is what the rest of the club sees you as.</p>
      <form action={joinAsNewMember.bind(null, clubId)} className="mt-1 flex gap-2">
        <label>
          First name
          <input
            type="text"
            name="firstName"
            required
            className="block border px-2 py-1"
          />
        </label>
        <label>
          Last initial
          <input
            type="text"
            name="lastInitial"
            required
            maxLength={1}
            size={2}
            className="block border px-2 py-1"
          />
        </label>
        <button type="submit" className="border px-3 py-1 self-end">
          Join
        </button>
      </form>
    </main>
  );
}
