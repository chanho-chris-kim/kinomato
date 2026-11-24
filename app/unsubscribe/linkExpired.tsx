import Link from "next/link";

// An unknown, malformed or expired unsubscribe link (ruled 2026-11-23).
export function LinkExpired() {
  return (
    <>
      <h1 className="h-display" style={{ fontSize: 26 }}>
        This link has expired
      </h1>
      <p className="muted mt14 unsubscribe-expired">
        This link has expired. You can change reminders in{" "}
        <Link href="/settings" className="underline">
          Settings
        </Link>
        .
      </p>
    </>
  );
}
