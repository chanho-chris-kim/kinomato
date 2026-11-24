// Retention (docs/onboarding-spec.md §11.6), as pure rules. The daily job
// (app/retentionCleanup.ts, run by the Cron Trigger in wrangler.jsonc)
// turns these cutoffs into its WHERE clauses; isPastRetention is the same
// rule for one row, so the boundaries are tested here.
//
// - magic_links, email_changes, account_deletion_requests, sessions:
//   deleted once they expired more than 7 days ago, used or not.
// - invites: a revoked invite's invitee_name is cleared once it was
//   revoked more than 90 days ago. Pending and redeemed invites are never
//   touched.
// - reminder_unsubscribe_tokens: deleted once more than 90 days old, when
//   they stop working (lib/reminderPrefs.ts, ruled 2026-11-23).
// - notification_log: deleted once more than 30 days old (ruled
//   2026-11-23). The budget looks back 7 days; never-twice is per night,
//   and no reminder's window reaches 30 days.

export const RETENTION = { expiredDays: 7, revokedInviteNameDays: 90, unsubscribeTokenDays: 90, notificationLogDays: 30 } as const;

const DAY_MS = 24 * 3600_000;

export function retentionCutoffs(now: Date): {
  expiredBefore: Date;
  revokedBefore: Date;
  unsubscribeTokensBefore: Date;
  notificationLogBefore: Date;
} {
  return {
    expiredBefore: new Date(now.getTime() - RETENTION.expiredDays * DAY_MS),
    revokedBefore: new Date(now.getTime() - RETENTION.revokedInviteNameDays * DAY_MS),
    unsubscribeTokensBefore: new Date(now.getTime() - RETENTION.unsubscribeTokenDays * DAY_MS),
    notificationLogBefore: new Date(now.getTime() - RETENTION.notificationLogDays * DAY_MS),
  };
}

// Strictly before the cutoff: a row exactly at it is kept until the next
// run. No date (an invite never revoked) is never past retention.
export function isPastRetention(at: Date | null, cutoff: Date): boolean {
  return at !== null && at.getTime() < cutoff.getTime();
}
