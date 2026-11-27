"use client";

import { useState } from "react";

// The sixth justified client component (u5): the clipboard only exists in
// the browser, as for ShareInvite. The code is always shown in a read-only
// field too, so it can be copied by hand and nothing depends on the API.
export function CopyCode({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // No clipboard here: the field selects itself to copy by hand.
    }
  }
  return (
    <div className="row gap8">
      <input
        className="field join-code"
        readOnly
        value={code}
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
      />
      <button type="button" className="btn auto" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
