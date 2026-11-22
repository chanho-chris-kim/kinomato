import { and, eq, sql } from "drizzle-orm";
import type { getDb } from "@/db";
import { memberships, nights, nominations, rsvps } from "@/db/schema";

// Passing a turn (ruled 2026-11-17, docs/onboarding-spec.md §5.10), with no
// request context: no redirect, no revalidatePath, no cookies, so the
// scheduled job (app/weeklyLoop.ts, a picker who never opened voting) can
// call it as well as passMyTurn and passTurnFor. Like lockNightCore.
//
// Deletes the empty draft and its RSVPs and sets the picker's postponed_at
// to the passed slot (lib/rotation.ts isSkippedThisTurn), as one batch that
// waits on the night still being an empty draft: a pass that lost a race
// (voting opened, or someone else passed it) changes nothing. Returns
// whether this call passed it.
export async function passDraftCore(
  db: ReturnType<typeof getDb>,
  draft: { id: string; scheduledAt: Date; pickerMembershipId: string },
): Promise<boolean> {
  const stillEmptyDraft = sql`exists (select 1 from ${nights} where ${nights.id} = ${draft.id} and ${nights.state} = 'draft' and not exists (select 1 from ${nominations} where ${nominations.nightId} = ${draft.id}))`;
  const [, , deleted] = await db.batch([
    db
      .update(memberships)
      .set({ postponedAt: draft.scheduledAt })
      .where(and(eq(memberships.id, draft.pickerMembershipId), stillEmptyDraft)),
    db.delete(rsvps).where(and(eq(rsvps.nightId, draft.id), stillEmptyDraft)),
    db.delete(nights).where(and(eq(nights.id, draft.id), stillEmptyDraft)).returning({ id: nights.id }),
  ]);
  return deleted.length > 0;
}
