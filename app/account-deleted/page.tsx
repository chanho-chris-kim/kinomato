import type { Metadata } from "next";
import { PublicShell } from "@/app/shell";

export const metadata: Metadata = { title: "Account deleted — Kinomato", robots: { index: false, follow: false } };

// Where Delete account lands (docs/onboarding-spec.md §11.4). Signed out by
// then; the page knows nothing about who arrived.
export default function AccountDeletedPage() {
  return (
    <PublicShell>
      <main className="p-4" style={{ maxWidth: 440, margin: "0 auto" }}>
        <div className="card" style={{ padding: "20px 18px" }}>
          <h1 className="h-display" style={{ fontSize: 28 }}>
            Your account was deleted.
          </h1>
        </div>
      </main>
    </PublicShell>
  );
}
