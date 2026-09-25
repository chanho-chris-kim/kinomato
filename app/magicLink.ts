import { headers } from "next/headers";
import type { getDb } from "@/db";
import { magicLinks } from "@/db/schema";
import { sendMagicLinkEmail } from "@/lib/email";

// 15 minutes — short-lived on purpose, unlike the session it eventually
// produces (app/session.ts). A magic link is a one-time credential in
// an inbox, not something that should still work days later.
const MAGIC_LINK_DURATION_MS = 15 * 60 * 1000;

// Cloudflare sets x-forwarded-proto; localhost has no forwarding at
// all, so it falls back to http. Derived per-request rather than a
// hardcoded domain env var — this app has two active deployments
// (dev.kinomato.com and per-branch *.workers.dev previews, CLAUDE.md)
// plus local dev, and a magic link has to point back at whichever one
// issued it.
async function getBaseUrl(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host");
  return `${proto}://${host}`;
}

// Shared by both magic-link flows this app has (CLAUDE.md): a plain
// login/recovery link (claimMembershipId unset) and a claim link (set
// — verifying it updates that membership in place, never creates a
// new one). One row, one email, one /verify handler for both; the
// membershipId presence is the only thing that distinguishes them.
export async function issueMagicLink(
  db: ReturnType<typeof getDb>,
  params: {
    email: string;
    claimMembershipId?: string;
    returnToClubId?: string;
  },
): Promise<void> {
  const token = crypto.randomUUID();
  await db.insert(magicLinks).values({
    email: params.email,
    token,
    claimMembershipId: params.claimMembershipId ?? null,
    returnToClubId: params.returnToClubId ?? null,
    expiresAt: new Date(Date.now() + MAGIC_LINK_DURATION_MS),
  });

  const baseUrl = await getBaseUrl();
  const verifyUrl = `${baseUrl}/verify?token=${token}`;
  await sendMagicLinkEmail(params.email, verifyUrl);
}
