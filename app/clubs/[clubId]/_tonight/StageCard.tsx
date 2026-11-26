import type { ReactNode } from "react";
import { Poster } from "../Poster";

// Tonight's cards (the Tonight redesign, ruled 2026-11-25). The page picks
// one card as the "do this now" card (`main`): it gets the accent edge and
// the page's only filled button. Every other card is the same component
// with main false, outlined buttons.
export function StageCard({
  main,
  eyebrow,
  title,
  id,
  className = "",
  children,
}: {
  main: boolean;
  eyebrow: string;
  title: ReactNode;
  id: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section className={`card stage mt14 ${main ? "now" : ""} ${className}`} aria-labelledby={`${id}-heading`}>
      <p className="eyebrow">{eyebrow}</p>
      <h2 id={`${id}-heading`} className="h-display stage-title">
        {title}
      </h2>
      {children}
    </section>
  );
}

// The do-this-now card's button is the only filled one on the page.
export function buttonClass(main: boolean, extra = ""): string {
  return `btn ${main ? "primary" : ""} ${extra}`.trim();
}

// A poster, or the film's title in its place when TMDB has none.
export function PosterBox({
  posterPath,
  title,
  size,
  className = "",
}: {
  posterPath: string | null;
  title: string;
  size: 92 | 185;
  className?: string;
}) {
  return (
    <span className={`poster ${className}`}>
      {posterPath ? <Poster posterPath={posterPath} title={title} size={size} /> : <span className="poster-fallback" data-title={title} aria-hidden="true" />}
    </span>
  );
}
