// Tonight's pure rules (the Tonight redesign, ruled 2026-11-25). No DB
// calls: the page loads the facts and these decide what they mean.

import { areTakesRevealed } from "./ratingReveal";

export const WEEK_STAGES = ["nominate", "vote", "locked", "watch", "rate"] as const;
export type WeekStage = (typeof WEEK_STAGES)[number];

export const WEEK_STAGE_LABELS: Record<WeekStage, string> = {
  nominate: "Nominate",
  vote: "Vote",
  locked: "Locked",
  watch: "Watch",
  rate: "Rate",
};

type NightState = "draft" | "open" | "locked" | "watched" | "cancelled" | "unconfirmed";

// Where the club is in its week. The night in flight decides it once
// voting has opened (the week has moved on); while it's still a draft, or
// there's none, a watched night whose ratings are open is Rate. A paused
// club, or nothing at all: no bar (null).
export function weekStage(input: {
  paused: boolean;
  inFlight: { state: "draft" | "open" | "locked"; scheduledAt: Date } | null;
  // The club's latest watched night isn't revealed yet (isVisiblyRevealed).
  ratingsOpen: boolean;
  now: Date;
}): WeekStage | null {
  if (input.paused) return null;
  const night = input.inFlight;
  if (night?.state === "open") return "vote";
  if (night?.state === "locked") return input.now.getTime() < night.scheduledAt.getTime() ? "locked" : "watch";
  if (input.ratingsOpen) return "rate";
  if (night?.state === "draft") return "nominate";
  return null;
}

// The phone's one line: "Step 2 of 5 · Vote · then Locked, Watch, Rate".
export function stepLine(stage: WeekStage): string {
  const index = WEEK_STAGES.indexOf(stage);
  const rest = WEEK_STAGES.slice(index + 1).map((s) => WEEK_STAGE_LABELS[s]);
  const head = `Step ${index + 1} of ${WEEK_STAGES.length} · ${WEEK_STAGE_LABELS[stage]}`;
  return rest.length ? `${head} · then ${rest.join(", ")}` : head;
}

// "Show vote counts while voting is open" (clubs.settings.showVoteCounts):
// an open night shows counts only when it's on; once voting has closed the
// result always shows. A draft has no votes.
export function voteCountsVisible(state: NightState, showVoteCounts: boolean): boolean {
  if (state === "draft") return false;
  if (state === "open") return showVoteCounts;
  return true;
}

// A night's ratings are revealed once a rating is visible: everyone who
// must rate has (lib/ratingReveal.ts) and at least one rating exists. With
// nobody RSVP'd yes and nobody rated, nothing has been shown yet.
export function isVisiblyRevealed(attendingMembershipIds: string[], ratedMembershipIds: string[]): boolean {
  return ratedMembershipIds.length > 0 && areTakesRevealed(attendingMembershipIds, ratedMembershipIds);
}

// "I was there" (ruled 2026-11-24): a watched night, not yet revealed, and
// you haven't answered. Someone who said no doesn't get it; someone who
// said yes already rates.
export function canSayIWasThere(input: {
  nightState: NightState;
  myRsvp: "yes" | "no" | null;
  revealed: boolean;
}): boolean {
  return input.nightState === "watched" && !input.revealed && input.myRsvp === null;
}

// "Won 3 to 1": the winner's votes against the runner-up's. Null when
// nobody voted (the picker's first choice won).
export function wonText(tally: { count: number; winner: boolean }[]): string | null {
  const winner = tally.find((t) => t.winner);
  if (!winner || tally.every((t) => t.count === 0)) return null;
  const others = tally.filter((t) => t !== winner);
  if (others.length === 0) return `Won with ${winner.count} ${winner.count === 1 ? "vote" : "votes"}`;
  return `Won ${winner.count} to ${Math.max(...others.map((t) => t.count))}`;
}

// "Starts in 2 days, 4 hours". Null once it has started (or within the
// minute).
export function startsIn(now: Date, at: Date): string | null {
  const minutes = Math.floor((at.getTime() - now.getTime()) / 60_000);
  if (minutes < 1) return null;
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `Starts in ${unit(days, "day")}${hours ? `, ${unit(hours, "hour")}` : ""}`;
  if (hours > 0) return `Starts in ${unit(hours, "hour")}${mins ? `, ${unit(mins, "minute")}` : ""}`;
  return `Starts in ${unit(mins, "minute")}`;
}
