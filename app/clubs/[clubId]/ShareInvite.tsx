"use client";

import { useState } from "react";

// The third justified client component, after NominationSelector and
// RatingSlider: the OS share sheet (navigator.share) and the clipboard
// only exist in the browser. Where there's a share sheet (every phone,
// most desktop browsers) the button opens it; where there isn't, it copies
// the link. The link is always visible too, so it can be copied by hand
// and nothing depends on either API existing (docs/onboarding-spec.md
// §7.1 step 3).
export function ShareInvite({
  url,
  inviteeName,
  clubName,
}: {
  url: string;
  inviteeName: string;
  clubName: string;
}) {
  const [copied, setCopied] = useState(false);
  const first = inviteeName.replace(/ [A-Za-z]\.$/, "");
  const text = `Hi ${first} — join ${clubName} on Kinomato`;

  async function share() {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: text, text, url });
        return;
      } catch {
        // Dismissed or unsupported for this payload: fall through to copy.
      }
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
  }

  return (
    <div className="stack gap8">
      <input
        className="small"
        readOnly
        value={url}
        aria-label={`Invite link for ${inviteeName}`}
        onFocus={(e) => e.currentTarget.select()}
        style={{ width: "100%" }}
      />
      <button type="button" className="btn" onClick={share}>
        {copied ? "Link copied" : "Share"}
      </button>
    </div>
  );
}
