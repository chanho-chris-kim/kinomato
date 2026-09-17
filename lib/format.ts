// Pure formatting helpers. No DB calls.

// "12 films · 21h 40m" (watchlist-spec.md §2.4) — the exact header shape
// that made total runtime worth showing at all.
export function formatRuntime(totalMinutes: number): string {
  const minutes = Math.floor(totalMinutes);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (hours === 0) return `${remainder}m`;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}
