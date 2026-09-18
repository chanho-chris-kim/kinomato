"use client";

import { useState } from "react";

export interface NominableFilm {
  id: string;
  title: string;
  year: number;
}

// The only interactive (client-side) piece on this route — everything
// else is plain forms and server actions. "Selecting and deselecting
// before submitting" plus a hard cap need actual state; this is
// React's built-in useState, not a state management library. The
// server action re-validates the cap independently (openVoting in
// ../actions.ts) rather than trusting this component's enforcement —
// this is UX, not the security boundary.
export function NominationSelector({ films, cap }: { films: NominableFilm[]; cap: number }) {
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
      <p className="text-sm">Pick up to {cap} from your watchlist.</p>
      <ul className="mt-1 space-y-1">
        {films.map((film) => {
          const checked = selected.includes(film.id);
          const disabled = !checked && selected.length >= cap;
          return (
            <li key={film.id}>
              <label className={disabled ? "text-gray-400" : ""}>
                <input
                  type="checkbox"
                  name="filmId"
                  value={film.id}
                  checked={checked}
                  disabled={disabled}
                  onChange={() => toggle(film.id)}
                />{" "}
                {film.title} ({film.year})
              </label>
            </li>
          );
        })}
      </ul>
      <button type="submit" disabled={selected.length === 0} className="border px-3 py-1 mt-2">
        Open voting
      </button>
    </div>
  );
}
