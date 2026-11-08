import { and, isNotNull, lt, ne } from "drizzle-orm";
import type { getDb } from "@/db";
import { invites, magicLinks, sessions } from "@/db/schema";
import { deleteExpiredDeletionRequests } from "@/app/accountDeletion";
import { deleteExpiredEmailChanges } from "@/app/emailChange";
import { retentionCutoffs } from "@/lib/retention";

type Db = ReturnType<typeof getDb>;

// Per table, by what the rows are rather than the guarded tables' own
// names (only their owning modules name those; see the access scans).
export interface RetentionCounts {
  sign_in_codes: number;
  email_change_requests: number;
  deletion_requests: number;
  sessions: number;
  invite_names_cleared: number;
}

// The daily retention job (docs/onboarding-spec.md §11.6), run only by the
// Cron Trigger (wrangler.jsonc → worker.ts's scheduled handler); no route
// reaches it. The cutoffs are lib/retention.ts's. One db.batch: it all
// lands or none of it does. The guarded tables are deleted through the
// modules that own them. Logs one line of counts and nothing else; any
// failure throws, so the run shows as failed in Workers Logs.
export async function runRetentionCleanup(db: Db, now: Date): Promise<RetentionCounts> {
  const { expiredBefore, revokedBefore } = retentionCutoffs(now);
  const [links, changes, deletions, oldSessions, names] = await db.batch([
    db.delete(magicLinks).where(lt(magicLinks.expiresAt, expiredBefore)).returning({ id: magicLinks.id }),
    deleteExpiredEmailChanges(db, expiredBefore),
    deleteExpiredDeletionRequests(db, expiredBefore),
    db.delete(sessions).where(lt(sessions.expiresAt, expiredBefore)).returning({ id: sessions.id }),
    db
      .update(invites)
      .set({ inviteeName: "" })
      .where(and(isNotNull(invites.revokedAt), lt(invites.revokedAt, revokedBefore), ne(invites.inviteeName, "")))
      .returning({ id: invites.id }),
  ]);
  const counts: RetentionCounts = {
    sign_in_codes: links.length,
    email_change_requests: changes.length,
    deletion_requests: deletions.length,
    sessions: oldSessions.length,
    invite_names_cleared: names.length,
  };
  console.log(`[retention] ${JSON.stringify(counts)}`);
  return counts;
}
