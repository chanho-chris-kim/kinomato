// The order the picker chose their nominees in (ruled 2026-11-21), stored
// as nominations.position: lock's last tiebreak, so when nobody votes the
// picker's first choice wins. Pure.
//
// `filmIds` are the films being nominated, in the form's order; `clickOrder`
// is the order the picker selected them in (NominationSelector's hidden
// fields). Click order first; anything it doesn't name (no script, a
// forged post) follows in the form's order.
export function orderNominations(filmIds: string[], clickOrder: string[]): string[] {
  const wanted = new Set(filmIds);
  const ordered = [...new Set(clickOrder.filter((id) => wanted.has(id)))];
  return [...ordered, ...filmIds.filter((id) => !ordered.includes(id))];
}
