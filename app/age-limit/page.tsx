import type { Metadata } from "next";
import { PublicShell } from "@/app/shell";

export const metadata: Metadata = { title: "13 and up — Kinomato", robots: { index: false, follow: false } };

// Where "Under 13" lands (docs/onboarding-spec.md §11.3). By the time
// anyone sees this, nothing of theirs is left and they're signed out; the
// page itself knows nothing about who arrived.
export default function AgeLimitPage() {
  return (
    <PublicShell>
      <main className="p-4" style={{ maxWidth: 440, margin: "0 auto" }}>
        <div className="card" style={{ padding: "20px 18px" }}>
          <h1 className="h-display" style={{ fontSize: 28 }}>
            Kinomato is for people 13 and up.
          </h1>
          <p className="small muted mt-1">You&apos;re signed out, and nothing that identifies you is kept.</p>
        </div>
      </main>
    </PublicShell>
  );
}
