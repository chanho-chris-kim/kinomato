import type { getDb } from "@/db";
import { sendOpsAlert } from "@/lib/email";
import { runRetentionCleanup } from "./retentionCleanup";
import { ScheduledJobFailure } from "./scheduledJobFailure";
import { runWeeklyLoop } from "./weeklyLoop";

type Db = ReturnType<typeof getDb>;

// The Cron Triggers' dispatch (wrangler.jsonc → worker.ts's scheduled
// handler): which job a trigger runs, by its cron string. No route
// reaches any of it. Keep these in step with wrangler.jsonc.
export const RETENTION_CRON = "0 10 * * *";
export const WEEKLY_LOOP_CRON = "0 * * * *";

export async function runScheduledJob(cron: string, db: Db, now: Date): Promise<void> {
  if (cron === RETENTION_CRON) {
    await withOpsAlert("retention", now, () => runRetentionCleanup(db, now));
  } else if (cron === WEEKLY_LOOP_CRON) {
    await withOpsAlert("weekly-loop", now, () => runWeeklyLoop(db, now));
  } else {
    throw new Error(`[scheduled] No job for cron "${cron}".`);
  }
}

// A failed run emails SUPPORT_EMAIL (lib/email.ts sendOpsAlert: job, time,
// counts only), then still fails: the throw is what marks the run failed
// in the Cron Events list. An alert that can't be sent is logged, and the
// run's own error is what's thrown.
export async function withOpsAlert<T>(job: "weekly-loop" | "retention", now: Date, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const counts = err instanceof ScheduledJobFailure ? err.counts : null;
    try {
      await sendOpsAlert(job, now, counts);
    } catch (alertErr) {
      console.error(`[ops-alert] Couldn't send the ${job} alert: ${alertErr instanceof Error ? alertErr.message : "unknown error"}`);
    }
    throw err;
  }
}
