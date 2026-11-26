// A step bar's steps (app/stepBar.tsx): Tonight's week, and an invited
// sign-up (ruled 2026-11-25, §5.13). Pure.

// Invited sign-up of a not-yet-named account: the invite landing, the code
// screen, the name step. Nothing after the name step has a bar.
export const SIGN_UP_STEPS = ["Email", "Code", "About you"] as const;

// The phone's one line: "Step 2 of 3 · Code · then About you".
export function stepsLine(labels: readonly string[], index: number): string {
  const head = `Step ${index + 1} of ${labels.length} · ${labels[index]}`;
  const rest = labels.slice(index + 1);
  return rest.length ? `${head} · then ${rest.join(", ")}` : head;
}

// "Resend available in 30 seconds": the wait the server enforces
// (lib/authCredentials.ts checkSendAllowed), in words. Null once a send is
// allowed.
export function resendWaitText(seconds: number): string | null {
  if (seconds <= 0) return null;
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}
