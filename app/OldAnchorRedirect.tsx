"use client";

import { useEffect } from "react";

// The seventh justified client component (u6; shared by Settings since u7):
// a page that became several. Links into the old single page named a
// section by its hash, and a hash never reaches the server, so only the
// browser can send such a link to the page that section became. Without
// script the page itself shows, and it links to every one of them.
export function OldAnchorRedirect({ base, moved }: { base: string; moved: Record<string, string> }) {
  useEffect(() => {
    const to = moved[window.location.hash];
    if (to) window.location.replace(`${base}${to}`);
  }, [base, moved]);
  return null;
}
