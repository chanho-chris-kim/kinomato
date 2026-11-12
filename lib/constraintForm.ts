// "Your limits in this club" (docs/onboarding-spec.md §5.10, ruled
// 2026-11-12): what a person may store as a hard limit or a preference,
// validated at write time (CLAUDE.md), and how it reads back. Pure.
// Genre limits store the TMDB id (CLAUDE.md: match on ids, never display
// strings); the label is for display only. Keyword is a later step and
// language is deferred, so neither is accepted here yet.

import { canAddHardLimit, type Constraint } from "./constraints";
import { formatRuntime } from "./format";

// TMDB's movie genres (GET /genre/movie/list). Stable ids, so a fixed list
// beats a fetch.
export const MOVIE_GENRES: { id: number; label: string }[] = [
  { id: 28, label: "Action" },
  { id: 12, label: "Adventure" },
  { id: 16, label: "Animation" },
  { id: 35, label: "Comedy" },
  { id: 80, label: "Crime" },
  { id: 99, label: "Documentary" },
  { id: 18, label: "Drama" },
  { id: 10751, label: "Family" },
  { id: 14, label: "Fantasy" },
  { id: 36, label: "History" },
  { id: 27, label: "Horror" },
  { id: 10402, label: "Music" },
  { id: 9648, label: "Mystery" },
  { id: 10749, label: "Romance" },
  { id: 878, label: "Science Fiction" },
  { id: 10770, label: "TV Movie" },
  { id: 53, label: "Thriller" },
  { id: 10752, label: "War" },
  { id: 37, label: "Western" },
];

export const MIN_RUNTIME_LIMIT = 30;
export const MAX_RUNTIME_LIMIT = 400;
export const HARD_LIMIT_CAP_MESSAGE = "You have two hard limits. Remove one, or add this as a preference.";

export interface NewLimit {
  kind: "hard" | "soft";
  ruleType: "genre" | "runtime";
  value: string;
  label: string | null;
}

type Existing = { kind: "hard" | "soft"; ruleType: string; value: string };

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// The add form's raw values against the person's limits in this club.
// Fixed messages, for the ?limitsError= convention.
export function readLimitForm(
  fields: { kind: unknown; ruleType: unknown; genre: unknown; minutes: unknown },
  existing: Existing[],
): { ok: true; limit: NewLimit } | { ok: false; error: string } {
  const kind = text(fields.kind);
  if (kind !== "hard" && kind !== "soft") return { ok: false, error: "Choose hard limit or preference." };
  const ruleType = text(fields.ruleType);
  if (ruleType !== "genre" && ruleType !== "runtime") return { ok: false, error: "Choose a genre or a length." };

  let limit: NewLimit;
  if (ruleType === "genre") {
    const raw = text(fields.genre);
    const genre = /^\d+$/.test(raw) ? MOVIE_GENRES.find((g) => g.id === Number(raw)) : undefined;
    if (!genre) return { ok: false, error: "Choose a genre from the list." };
    limit = { kind, ruleType, value: String(genre.id), label: genre.label };
  } else {
    const raw = text(fields.minutes);
    const minutes = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!(minutes >= MIN_RUNTIME_LIMIT && minutes <= MAX_RUNTIME_LIMIT)) {
      return { ok: false, error: "Length must be a whole number of minutes from 30 to 400." };
    }
    limit = { kind, ruleType, value: String(minutes), label: null };
  }

  if (existing.some((e) => e.ruleType === limit.ruleType && e.value === limit.value)) {
    return { ok: false, error: "You already have that one." };
  }
  if (kind === "hard" && !canAddHardLimit(existing as Constraint[])) {
    return { ok: false, error: HARD_LIMIT_CAP_MESSAGE };
  }
  return { ok: true, limit };
}

// "Hard limit: Horror", "Prefer not: Nothing over 2h 15m".
export function describeLimit(limit: { kind: "hard" | "soft"; ruleType: string; value: string; label: string | null }): string {
  const prefix = limit.kind === "hard" ? "Hard limit" : "Prefer not";
  let what: string;
  if (limit.ruleType === "genre") {
    what = MOVIE_GENRES.find((g) => String(g.id) === limit.value)?.label ?? limit.label ?? "A genre";
  } else if (limit.ruleType === "runtime") {
    what = `Nothing over ${formatRuntime(Number(limit.value))}`;
  } else {
    what = limit.label ?? limit.value;
  }
  return `${prefix}: ${what}`;
}
