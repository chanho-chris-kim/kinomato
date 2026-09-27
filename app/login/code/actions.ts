"use server";

import { eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { magicLinks } from "@/db/schema";
import { completeSignIn, latestSignInFor } from "@/app/signIn";
import {
  CODE_MAX_ATTEMPTS,
  codeMatches,
  evaluateSignIn,
  getAuthSecret,
} from "@/lib/authCredentials";

// The primary sign-in path (docs/onboarding-spec.md §4.2). Only the newest
// code sent to an address counts. Every outcome that isn't success lands
// back on the code screen with a message, via the ?error= convention.
export async function submitCode(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const code = String(formData.get("code") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "").trim() || undefined;
  const back = (error: string, extra: Record<string, string> = {}) => {
    const qs = new URLSearchParams({ email, error, ...extra });
    if (returnTo) qs.set("returnTo", returnTo);
    redirect(`/login/code?${qs.toString()}`);
  };

  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const link = await latestSignInFor(db, email);
  if (!link) back("expired");
  const state = evaluateSignIn(link!, new Date());
  if (state !== "usable") back(state);

  if (!codeMatches(code, link!.codeHash, getAuthSecret())) {
    // Counted in SQL, not from the value read above, so two quick wrong
    // submits can't both see the same count.
    const [updated] = await db
      .update(magicLinks)
      .set({ attempts: sql`${magicLinks.attempts} + 1` })
      .where(eq(magicLinks.id, link!.id))
      .returning({ attempts: magicLinks.attempts });
    const left = CODE_MAX_ATTEMPTS - updated.attempts;
    if (left <= 0) back("locked");
    back("wrong", { left: String(left) });
  }

  const destination = await completeSignIn(db, link!.id);
  if (!destination) back("consumed");
  redirect(destination!);
}
