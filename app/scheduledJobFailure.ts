// A scheduled job that finished its run with failures: thrown at the end so
// the run shows as failed, carrying its counts for the ops alert
// (app/scheduledJobs.ts). Counts only: never an error message or row data.
export class ScheduledJobFailure extends Error {
  constructor(
    readonly job: string,
    readonly counts: Record<string, number>,
  ) {
    super(`[${job}] ${counts.failed ?? "some"} item(s) failed this run; see the lines above.`);
    this.name = "ScheduledJobFailure";
  }
}
