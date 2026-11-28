"use client";

import { useEffect } from "react";

// The seventh justified client component (u6): before u6 the Members tab
// was one page, and links into it named a section by its hash (#limits,
// #club-settings, …). A hash never reaches the server, so only the browser
// can send such a link to the page that section became. Without script the
// main Members page shows, which links to every one of them.
const MOVED: Record<string, string> = {
  "#limits": "/limits",
  "#limits-heading": "/limits",
  "#club-settings": "/settings",
  "#club-details": "/settings",
  "#join-code": "/settings#join-code",
  "#add-person": "/invite",
};

export function OldAnchorRedirect({ clubId }: { clubId: string }) {
  useEffect(() => {
    const to = MOVED[window.location.hash];
    if (to) window.location.replace(`/clubs/${clubId}/members${to}`);
  }, [clubId]);
  return null;
}
