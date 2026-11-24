// Postgres error codes, read off what drizzle/neon-http throws. Pure.

const codeOf = (e: unknown) =>
  typeof e === "object" && e !== null && "code" in e ? (e as { code?: unknown }).code : undefined;

// A unique index rejected the write (23505). A batch may report the code on
// the error's cause.
export function isUniqueViolation(error: unknown): boolean {
  if (codeOf(error) === "23505") return true;
  const cause = typeof error === "object" && error !== null ? (error as { cause?: unknown }).cause : undefined;
  return codeOf(cause) === "23505";
}
