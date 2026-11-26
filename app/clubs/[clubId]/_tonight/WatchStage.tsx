import type { ReactNode } from "react";
import { confirmNight } from "../actions";
import { PosterBox, StageCard } from "./StageCard";

export interface LockedFilm {
  title: string;
  year: number;
  runtime: number | null;
  posterPath: string | null;
  director: string | null;
}

// Locked, and Watch until the prompt is due: the film is the hero (the
// Tonight redesign, ruled 2026-11-25). Pure display over the night and its
// film; nothing here changes anything (CLAUDE.md "locked display").
export function LockedHero({
  main,
  film,
  countdown,
  started,
  result,
  startsLabel,
  outByLabel,
  unconfirmNote,
}: {
  main: boolean;
  film: LockedFilm;
  // "Starts in 2 days, 4 hours", or null once it has started.
  countdown: string | null;
  started: boolean;
  // "Won 3 to 1", or the picker's first choice when nobody voted.
  result: string;
  startsLabel: string;
  outByLabel: string | null;
  unconfirmNote: ReactNode;
}) {
  return (
    <StageCard
      main={main}
      id="locked"
      eyebrow={started ? "Watching" : "This week's film"}
      title={film.title}
      className="locked-hero"
    >
      <div className="hero-row mt14">
        <PosterBox posterPath={film.posterPath} title={film.title} size={185} className="hero-poster" />
        <div className="grow">
          <span className="pill">Locked in</span>
          {countdown && <p className="small mt14 countdown">{countdown}</p>}
          {started && <p className="small mt14 countdown">Started {startsLabel}</p>}
          <p className="small muted mt-1 locked-meta">
            {[String(film.year), film.director, result].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
      <div className="locked-times">
        <div>
          <div className="tiny dim">starts</div>
          <div className="locked-time">{startsLabel}</div>
        </div>
        <div>
          <div className="tiny dim">runs</div>
          <div className="locked-time">{film.runtime !== null ? `${film.runtime}m` : "—"}</div>
        </div>
        <div>
          <div className="tiny dim">out by</div>
          <div className="locked-time you">{outByLabel ?? "—"}</div>
        </div>
      </div>
      {unconfirmNote}
    </StageCard>
  );
}

// "Did you watch X?" once the club's confirm timing allows it.
export function ConfirmCard({
  main,
  clubId,
  nightId,
  nightLabel,
  filmTitle,
  unconfirmNote,
}: {
  main: boolean;
  clubId: string;
  nightId: string;
  // lib/clubStatus.ts nightName: "Saturday night".
  nightLabel: string;
  filmTitle: string | null;
  unconfirmNote: ReactNode;
}) {
  return (
    <StageCard main={main} id="confirm" eyebrow={main ? "Your move" : "Watch"} title={`Did you watch ${filmTitle ?? "it"}?`}>
      <p className="eyebrow mt-1 confirm-night">{nightLabel}</p>
      <div className="row gap8 mt14">
        <form action={confirmNight.bind(null, clubId, nightId, "watched")} className="grow">
          <button type="submit" className={`btn ${main ? "primary" : ""}`}>
            Yes
          </button>
        </form>
        <form action={confirmNight.bind(null, clubId, nightId, "cancelled")} className="grow">
          <button type="submit" className="btn ghost">
            We didn&apos;t meet
          </button>
        </form>
      </div>
      {unconfirmNote}
    </StageCard>
  );
}

// "Did you watch X after all?" (ruled 2026-11-21): only Yes.
export function LateConfirmCard({
  main,
  clubId,
  nightId,
  filmTitle,
}: {
  main: boolean;
  clubId: string;
  nightId: string;
  filmTitle: string | null;
}) {
  return (
    <StageCard
      main={main}
      id="late-confirm"
      eyebrow="Nobody answered in time"
      title={`Did you watch ${filmTitle ?? "it"} after all?`}
      className="late-confirm"
    >
      <form action={confirmNight.bind(null, clubId, nightId, "watched")} className="mt14">
        <button type="submit" className={`btn ${main ? "primary" : ""}`}>
          Yes, we watched it
        </button>
      </form>
    </StageCard>
  );
}
