"use client";

import { useEffect, useState } from "react";

// The third justified client component, after NominationSelector and
// RatingSlider: the OS share sheet (navigator.share) and the clipboard
// only exist in the browser. Where there's a share sheet (every phone,
// most desktop browsers) the button opens it; where there isn't, it copies
// the link. The link is always visible too, so it can be copied by hand
// and nothing depends on either API existing (docs/onboarding-spec.md
// §7.1 step 3).
//
// `separate` (the invite page, u4): "Share" only where there's a share
// sheet, and "Copy link" always, side by side.
export function ShareInvite({
  url,
  inviteeName,
  clubName,
  separate = false,
}: {
  url: string;
  inviteeName: string;
  clubName: string;
  separate?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  // Known only in the browser, after the first render: no Share button
  // until then, and none where there's no share sheet.
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a browser capability, readable only after mount
    setCanShare(typeof navigator.share === "function");
  }, []);
  // The inviter's greeting, as typed (ruled 2026-11-25).
  const text = `Hi ${inviteeName} — join ${clubName} on Kinomato`;

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

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // No clipboard here: the link is selected in its field to copy by hand.
    }
  }

  if (separate) {
    return (
      <div className="stack gap8">
        <input
          className="small field"
          readOnly
          value={url}
          aria-label={`Invite link for ${inviteeName}`}
          onFocus={(e) => e.currentTarget.select()}
          style={{ width: "100%" }}
        />
        <div className="row gap8">
          {canShare && (
            <button type="button" className="btn grow" onClick={() => navigator.share({ title: text, text, url }).catch(() => {})}>
              Share
            </button>
          )}
          <button type="button" className="btn grow" onClick={copy}>
            {copied ? "Link copied" : "Copy link"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack gap8">
      <input
        className="small field"
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
