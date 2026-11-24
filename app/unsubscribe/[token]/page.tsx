import type { Metadata } from "next";
import { getDb } from "@/db";
import { PublicShell } from "@/app/shell";
import { loadUnsubscribeToken } from "@/app/reminderUnsubscribe";
import { LinkExpired } from "../linkExpired";
import { muteClubReminders, stopAllReminders } from "./actions";

// The unsubscribe link from a reminder email (docs/onboarding-spec.md §5.9,
// ruled 2026-11-23): public, works signed out, no consent gate (it only
// ever turns reminders off, for the one person and club the link was made
// for). Opening it changes nothing, since email scanners open links; only
// pressing a button does (a POST). No email, name or id in the URL: just
// the opaque token. Nothing third-party on the page.
export const metadata: Metadata = { title: "Reminder emails — Kinomato", robots: { index: false, follow: false } };

const BIG = { padding: "18px 16px", fontSize: 17, textAlign: "center" as const };

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // eslint-disable-next-line react-hooks/purity -- a Server Component, once per request
  const link = await loadUnsubscribeToken(getDb(), token, new Date(Date.now()));

  return (
    <PublicShell>
      <main className="p-4" style={{ maxWidth: 480, margin: "0 auto" }}>
        {link ? (
          <>
            <h1 className="h-display" style={{ fontSize: 26 }}>
              Reminder emails
            </h1>
            <p className="muted mt14">Choose what to stop. Sign-in codes and account notices always arrive.</p>
            <form action={stopAllReminders.bind(null, token)} className="mt20">
              <button type="submit" className="btn primary" style={BIG}>
                Stop all reminder emails
              </button>
            </form>
            <form action={muteClubReminders.bind(null, token)} className="mt14">
              <button type="submit" className="btn" style={BIG}>
                Mute only {link.clubName}
              </button>
            </form>
          </>
        ) : (
          <LinkExpired />
        )}
      </main>
    </PublicShell>
  );
}
