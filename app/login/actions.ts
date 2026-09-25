"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { issueMagicLink } from "@/app/magicLink";

// Plain login/recovery — no claimMembershipId, unlike requestClaim in
// app/clubs/[clubId]/actions.ts. This is what "identity survives a
// cleared cookie or a new device" (CLAUDE.md) actually runs on: the
// same users row is found again by email, so every membership whose
// identityKey is that user's id is recognized immediately, no matter
// how many times this is clicked from a fresh browser.
export async function requestLogin(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const returnTo = String(formData.get("returnTo") ?? "").trim() || undefined;

  if (!email || !email.includes("@")) {
    const qs = new URLSearchParams({ error: "Enter a valid email address." });
    if (returnTo) qs.set("returnTo", returnTo);
    redirect(`/login?${qs.toString()}`);
  }

  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  await issueMagicLink(db, { email, returnToClubId: returnTo });

  const qs = new URLSearchParams({ sent: email });
  if (returnTo) qs.set("returnTo", returnTo);
  redirect(`/login?${qs.toString()}`);
}
