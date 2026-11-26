"use client";

import Image from "next/image";
import { useState } from "react";

export interface NominableFilm {
  id: string;
  title: string;
  year: number;
  posterPath: string | null;
}

// The only interactive (client-side) piece on this route — everything
// else is plain forms and server actions. "Selecting and deselecting
// before submitting" plus a hard cap need actual state; this is
// React's built-in useState, not a state management library. The
// server action re-validates the cap independently (openVoting in
// ../actions.ts) rather than trusting this component's enforcement —
// this is UX, not the security boundary.
//
// Poster cards (the Tonight redesign, 2026-11-25): each film is a label
// around its checkbox, so the whole card ticks it, and a ticked film shows
// its place in the picker's order. `primary`: when this is the page's
// "do this now" card, Open voting is its one filled button.
export function NominationSelector({ films, cap, primary }: { films: NominableFilm[]; cap: number; primary: boolean }) {
  const [selected, setSelected] = useState<string[]>([]);

  function toggle(filmId: string) {
    setSelected((prev) =>
      prev.includes(filmId)
        ? prev.filter((id) => id !== filmId)
        : prev.length < cap
          ? [...prev, filmId]
          : prev,
    );
  }

  return (
    <div>
      <p className="small muted">Pick up to {cap} from your watchlist.</p>
      {cap > 1 && <p className="tiny dim flush">The order you pick them in is your order of choice.</p>}
      <ul className="pick-grid mt14">
        {films.map((film) => {
          const checked = selected.includes(film.id);
          const disabled = !checked && selected.length >= cap;
          return (
            <li key={film.id} className={`nominee pick-card ${checked ? "picked" : ""}`}>
              <label className={disabled ? "dim" : ""}>
                <input
                  type="checkbox"
                  name="filmId"
                  value={film.id}
                  checked={checked}
                  disabled={disabled}
                  onChange={() => toggle(film.id)}
                />
                <span className="poster pick-poster">
                  {film.posterPath ? (
                    <Image
                      src={`https://image.tmdb.org/t/p/w185${film.posterPath}`}
                      alt=""
                      width={185}
                      height={278}
                    />
                  ) : (
                    <span className="poster-fallback" data-title={film.title} aria-hidden="true" />
                  )}
                </span>
                <span className="pick-text">
                  <span className="small">
                    {film.title} <span className="dim">({film.year})</span>
                  </span>
                  {checked && (
                    <span className="pill choice-rank">{ordinal(selected.indexOf(film.id) + 1)} choice</span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {/* The order picked in (ruled 2026-11-21): with no votes, the first
          choice wins. Without script the form's order stands. */}
      {selected.map((id) => (
        <input key={id} type="hidden" name="filmOrder" value={id} />
      ))}
      {cap > 1 && <p className="tiny dim mt14">If nobody votes, your first choice wins.</p>}
      <button
        type="submit"
        disabled={selected.length === 0}
        className={`btn mt14 ${primary ? "primary" : ""}`}
      >
        Open voting
      </button>
    </div>
  );
}

function ordinal(n: number): string {
  return ["1st", "2nd", "3rd", "4th", "5th"][n - 1] ?? `${n}th`;
}
