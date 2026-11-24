"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { muteClubRemindersByToken, stopAllRemindersByToken } from "@/app/reminderUnsubscribe";

// The unsubscribe page's two buttons (ruled 2026-11-23). No session needed:
// the token is the only credential, checked server-side on every press, and
// it acts only on its own person and club (app/reminderUnsubscribe.ts). A
// link that no longer works lands on the expired message and changes
// nothing.

export async function stopAllReminders(token: string) {
  const done = await stopAllRemindersByToken(getDb(), token, new Date());
  redirect(done ? "/unsubscribe/done" : "/unsubscribe/expired");
}

export async function muteClubReminders(token: string) {
  const done = await muteClubRemindersByToken(getDb(), token, new Date());
  redirect(done ? "/unsubscribe/done" : "/unsubscribe/expired");
}
