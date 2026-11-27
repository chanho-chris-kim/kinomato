// A step bar's steps (app/stepBar.tsx): Tonight's week, and an invited
// sign-up (ruled 2026-11-25, §5.13). Pure.

// Invited sign-up of a not-yet-named account: the invite landing, the code
// screen, the name step. Nothing after the name step has a bar.
export const SIGN_UP_STEPS = ["Email", "Code", "About you"] as const;

// "Start a club" with sign-up open (u4): the same three, then the club. An
// account already named skips About you, which shows as done.
export const START_CLUB_STEPS = ["Email", "Code", "About you", "Your club"] as const;

// Where "Start a club" ends, carried as returnTo through sign-in: the flow's
// only marker, a fixed path with nothing personal in it.
export const START_CLUB_PATH = "/new?start=1";

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
