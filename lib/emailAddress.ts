// Email addresses, the one shared place they're normalised and masked
// (docs/onboarding-spec.md §5.9 rulings). Pure.

// Every place an email is entered (sign-in, an invite, an email change)
// normalises the same way, so the same person always finds the same
// users row.
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// "nadia@gmail.com" -> "n•••@gmail.com": enough for its owner to recognise,
// never the full address. One character of the local part, however long
// it is; the domain as is.
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at === -1) return "•••";
  const local = email.slice(0, at);
  return `${local.slice(0, 1)}•••${email.slice(at)}`;
}
