"use server";

import { and, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { memberships, users } from "@/db/schema";
import { safePath } from "@/app/baseUrl";
import { getSessionUserId } from "@/app/session";
import { validateMemberName } from "@/lib/memberName";

// The name step (docs/onboarding-spec.md §5.6): first name + last initial,
// the same validation as everywhere else a name is entered. The name lives
// on users. Until rebuild step 4b drops memberships.display_name, it's
// copied onto this account's active memberships too — for accounts that
// reach this step, those are only memberships just created from an
// invite, which carried the owner's typed name as a placeholder.
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

  await db.batch([
    db.update(users).set({ displayName: result.displayName }).where(eq(users.id, userId)),
    db
      .update(memberships)
      .set({ displayName: result.displayName })
      .where(and(eq(memberships.userId, userId), isNull(memberships.leftAt))),
  ]);
  redirect(next);
}
