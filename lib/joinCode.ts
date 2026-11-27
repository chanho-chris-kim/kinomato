// Club codes (u5, ruled 2026-11-25; details 2026-11-26): 8 characters of
// Crockford base32, shown XXXX-XXXX. Pure: generation takes its random
// bytes, so it's testable; the default is crypto randomness.

// No I, L, O or U: nothing to misread, and no accidental words.
export const JOIN_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const JOIN_CODE_LENGTH = 8;

const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

// Each byte picks a symbol by its low five bits: 256 is 8 × 32, so every
// symbol is equally likely. 40 bits: a guess at a live code, with ten tries
// an hour per person, is hopeless.
export function generateJoinCode(random: (n: number) => Uint8Array = randomBytes): string {
  return Array.from(random(JOIN_CODE_LENGTH), (b) => JOIN_CODE_ALPHABET[b & 31]).join("");
}

export function formatJoinCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

// What someone typed, as the stored form, or null. Case, dashes (any kind
// a phone types) and spaces don't matter; I and L read as 1 and O as 0, as
// Crockford decoding does.
export function normaliseJoinCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const code = input
    .replace(/[\s\-‐‑‒–—―]/g, "")
    .toUpperCase()
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
  if (code.length !== JOIN_CODE_LENGTH) return null;
  for (const c of code) if (!JOIN_CODE_ALPHABET.includes(c)) return null;
  return code;
}
