import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { clubs } from "@/db/schema";
import { requireClubMember } from "@/app/auth";
import { setClubPaused } from "../../../actions";
import { MembersFrame } from "../../membersFrame";

// Pause or resume the club (u6; the rule ruled 2026-11-10): owners and
// admins, everyone else a 404. Pausing never ends the night in flight;
// nothing new is scheduled while paused.
export default async function PausePage({ params }: { params: Promise<{ clubId: string }> }) {
  const { clubId } = await params;
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const { membership: me } = await requireClubMember(clubId, `/clubs/${clubId}/members/settings/pause`);
  if (me.role !== "owner" && me.role !== "admin") notFound();
  const [club] = await db.select().from(clubs).where(eq(clubs.id, clubId));
  const paused = club.pausedAt !== null;

  return (
    <MembersFrame db={db} club={club} role={me.role}>
      <h2 className="h-display stage-title mt14 page-title">{paused ? `${club.name} is paused` : `Pause ${club.name}`}</h2>
      <p className="small muted mt-1 pause-explain">
        {paused
          ? "No new nights are being scheduled. Resuming schedules the next night as usual."
          : "Pausing stops new nights being scheduled. A night already under way carries on. You can resume any time."}
      </p>
      <form action={setClubPaused.bind(null, clubId, !paused)} className="row gap8 mt14">
        <button type="submit" className="btn primary auto">
          {paused ? "Resume the club" : "Pause the club"}
        </button>
        <Link href={`/clubs/${clubId}/members/settings`} className="btn ghost auto">
          Cancel
        </Link>
      </form>
    </MembersFrame>
  );
}
