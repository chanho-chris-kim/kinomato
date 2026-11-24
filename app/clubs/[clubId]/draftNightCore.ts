import { eq } from "drizzle-orm";
import type { getDb } from "@/db";
import { memberships, nights } from "@/db/schema";
import { getDraftToCreate, type StatusClub, type StatusNight } from "@/lib/clubStatus";
import { isUniqueViolation } from "@/lib/dbErrors";
import type { RotationMembership } from "@/lib/rotation";

// Creating a club's next draft night, with no request context (no
// redirect, no revalidatePath, no cookies), so both Tonight's lazy creation
// (page.tsx) and the hourly job (app/weeklyLoop.ts, ruled 2026-11-22) use
// it. Like lockNightCore and passDraftCore.
//
// lib/clubStatus.ts getDraftToCreate decides: nothing in flight, someone
// to pick (rotation, paused clubs skipped, departed members never picked),
// and a schedule to compute from (ad_hoc never). The night and its
// picker's postponed_at cleared go together (ruled 2026-11-17: cleared
// when a night is next created with them as picker). "A club has at most
// one night in flight" is a partial unique index, so a page load and the
// job racing leave one draft: the loser's insert is rejected (23505) and
// comes back as "raced", not a failure. "none" means there was nothing to
// create. Anything else is a real failure and throws. getDraftToCreate
// never offers a draft already due to be auto-passed (ruled 2026-11-23), so
// the page and the job behave the same.
export type DraftOutcome = "created" | "raced" | "none";

export async function createDraftNightCore(
  db: ReturnType<typeof getDb>,
  input: {
    clubId: string;
    club: StatusClub;
    memberships: RotationMembership[];
    nights: StatusNight[];
    now: Date;
  },
): Promise<DraftOutcome> {
  const draft = getDraftToCreate({
    club: input.club,
    memberships: input.memberships,
    nights: input.nights,
    now: input.now,
  });
  if (!draft) return "none";
  try {
    await db.batch([
      db.insert(nights).values({
        clubId: input.clubId,
        scheduledAt: draft.scheduledAt,
        pickerMembershipId: draft.pickerMembershipId,
        state: "draft",
      }),
      db.update(memberships).set({ postponedAt: null }).where(eq(memberships.id, draft.pickerMembershipId)),
    ]);
    return "created";
  } catch (error) {
    if (isUniqueViolation(error)) return "raced";
    throw error;
  }
}
