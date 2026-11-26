"use client";

import { useEffect, useState } from "react";
import { resendWaitText } from "@/lib/steps";

// Resend, held back for as long as the server would refuse another send
// (lib/authCredentials.ts: 30 seconds after the last, 5 an hour). The
// fourth justified client component (CLAUDE.md): only the countdown ticks
// here. Without script, the server's render stands: disabled, with the
// wait in words, until the page is reloaded. The server still refuses an
// early send whatever this shows.
export function ResendButton({
  waitSeconds,
  label,
  primary,
}: {
  waitSeconds: number;
  label: string;
  primary: boolean;
}) {
  const [left, setLeft] = useState(waitSeconds);
  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);
  const wait = resendWaitText(left);
  return (
    <>
      <button type="submit" className={`btn ${primary ? "primary" : ""}`} disabled={wait !== null}>
        {label}
      </button>
      {wait && <p className="tiny dim mt-1 resend-wait">Resend available in {wait}</p>}
    </>
  );
}
