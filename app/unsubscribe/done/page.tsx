import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/app/shell";

// After a button on the unsubscribe page (ruled 2026-11-23). Knows nothing
// about who pressed it.
export const metadata: Metadata = { title: "Done — Kinomato", robots: { index: false, follow: false } };

export default function UnsubscribeDonePage() {
  return (
    <PublicShell>
      <main className="p-4" style={{ maxWidth: 480, margin: "0 auto" }}>
        <h1 className="h-display" style={{ fontSize: 26 }}>
          Done
        </h1>
        <p className="muted mt14 unsubscribe-done">
          Done. You can turn reminders back on in{" "}
          <Link href="/settings/reminders" className="underline">
            Settings
          </Link>
          .
        </p>
      </main>
    </PublicShell>
  );
}
