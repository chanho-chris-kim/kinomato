import type { Metadata } from "next";
import { PublicShell } from "@/app/shell";
import { LinkExpired } from "../linkExpired";

// Where a button lands when its link no longer worked (ruled 2026-11-23).
export const metadata: Metadata = { title: "Link expired — Kinomato", robots: { index: false, follow: false } };

export default function UnsubscribeExpiredPage() {
  return (
    <PublicShell>
      <main className="p-4" style={{ maxWidth: 480, margin: "0 auto" }}>
        <LinkExpired />
      </main>
    </PublicShell>
  );
}
