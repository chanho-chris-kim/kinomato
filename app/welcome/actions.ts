"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { safePath } from "@/app/baseUrl";
import { getSessionUserId } from "@/app/session";
import { validateMemberName } from "@/lib/memberName";

// The name step (docs/onboarding-spec.md §5.6): first name + last initial,
// the same validation as everywhere else a name is entered. The name lives
// on users, and every club reads it from there.
export async function saveName(formData: FormData) {
  const next = safePath(String(formData.get("next") ?? ""));
  const invite = String(formData.get("invite") ?? "");
  const firstName = String(formData.get("firstName") ?? "");
  const lastInitial = String(formData.get("lastInitial") ?? "");

  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const userId = await getSessionUserId(db);
  if (!userId) redirect(`/login`);

  const result = validateMemberName(firstName, lastInitial);
  if ("error" in result) {
    const qs = new URLSearchParams({ next, error: result.error, first: firstName, initial: lastInitial });
    if (invite) qs.set("invite", invite);
    redirect(`/welcome?${qs.toString()}`);
  }

  await db.update(users).set({ displayName: result.displayName }).where(eq(users.id, userId));
  redirect(next);
}
