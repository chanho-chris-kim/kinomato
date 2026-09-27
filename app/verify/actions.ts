"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { magicLinks } from "@/db/schema";
import { completeSignIn } from "@/app/signIn";
import { evaluateSignIn, hashToken } from "@/lib/authCredentials";

// The only thing that signs anyone in from a link: a person pressing the
// button on /verify. Opening the page doesn't (docs/onboarding-spec.md
// §4.2) — email scanners pre-open links and would burn them.
export async function verifyLink(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const retry = `/verify?token=${encodeURIComponent(token)}`;
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const [link] = await db.select().from(magicLinks).where(eq(magicLinks.tokenHash, hashToken(token)));
  // Only consumed or expired stops a link — the code's attempt limit
  // doesn't apply to it.
  const state = link ? evaluateSignIn(link, new Date()) : "expired";
  if (state === "consumed" || state === "expired") redirect(retry);
  const destination = await completeSignIn(db, link!.id);
  redirect(destination ?? retry);
}
