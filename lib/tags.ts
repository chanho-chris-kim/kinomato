// Pure. No DB calls.
//
// Club-scoped tags (CLAUDE.md: "cozy" is one tag rather than six
// near-duplicates across members) live or die on this normalization
// being applied consistently at every write site — the unique index is
// on (club_id, name), so two members' tags only collide into the same
// row if this function maps them to the same `name`.

export interface NormalizedTag {
  // Lookup/uniqueness key — lowercase, trimmed, inner whitespace collapsed.
  name: string;
  // First-seen casing, for display — same trimming and whitespace
  // collapse as `name`, but not lowercased.
  displayName: string;
}

export function normalizeTag(raw: string): NormalizedTag | null {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  if (!collapsed) {
    return null;
  }
  return { name: collapsed.toLowerCase(), displayName: collapsed };
}
