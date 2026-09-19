"use server";

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { memberships } from "@/db/schema";
import { canAddMember, FREE_TIER_MEMBER_CAP, isDisplayNameTaken } from "@/lib/clubMembers";
import { validateMemberName } from "@/lib/memberName";
import { identityCookieName } from "../identity";

async function setIdentityCookie(clubId: string, membershipId: string) {
  const cookieStore = await cookies();
  cookieStore.set(identityCookieName(clubId), membershipId, {
    httpOnly: true,
    sameSite: "lax",
    path: `/clubs/${clubId}`,
  });
}

function joinErrorUrl(clubId: string, message: string): string {
  return `/clubs/${clubId}/join?error=${encodeURIComponent(message)}`;
}

// Same "pick a name, set a cookie" mechanism as pickIdentity in
// app/clubs/[clubId]/actions.ts, kept as its own action rather than
// imported — this route's job is specifically "claim an invite," and
// the two are free to diverge later (e.g. this one could eventually
// check an invite token pickIdentity never sees).
export async function claimExistingName(clubId: string, membershipId: string) {
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const [membership] = await db
    .select()
    .from(memberships)
    .where(eq(memberships.id, membershipId));
  if (!membership || membership.clubId !== clubId || membership.leftAt !== null) {
    redirect(joinErrorUrl(clubId, "That member no longer exists in this club."));
  }

  await setIdentityCookie(clubId, membershipId);
  redirect(`/clubs/${clubId}`);
}

// Free-tier cap (CLAUDE.md, lib/clubMembers.ts) is checked here, not at
// club creation only — an invite can be shared far beyond the people the
// owner pre-added, and this is the moment a seventh person actually
// shows up. Checked and inserted as two separate statements rather than
// one atomic guarded write (no partial-count DB constraint exists for
// this) — a soft business-tier cap, not a safety invariant like "one
// night in flight," so a narrow race under truly simultaneous joins is
// an accepted gap, not one this function closes.
//
// Validation failures redirect back to the join page with a readable
// message in a query param rather than throwing — same reasoning as
// app/new/actions.ts: a plain <form action> has no error boundary, and
// the free-tier cap explicitly needs "a clear message," not a dev-mode
// error overlay.
export async function joinAsNewMember(clubId: string, formData: FormData) {
  const nameResult = validateMemberName(
    String(formData.get("firstName") ?? ""),
    String(formData.get("lastInitial") ?? ""),
  );
  if ("error" in nameResult) {
    redirect(joinErrorUrl(clubId, nameResult.error));
  }
  const displayName = nameResult.displayName;

  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const clubMemberships = await db
    .select()
    .from(memberships)
    .where(eq(memberships.clubId, clubId));
  const active = clubMemberships.filter((m) => m.leftAt === null);

  if (!canAddMember(active.length)) {
    redirect(
      joinErrorUrl(
        clubId,
        `This club is at the free-tier limit of ${FREE_TIER_MEMBER_CAP} members — ` +
          "ask the owner to free up a spot before joining.",
      ),
    );
  }
  if (isDisplayNameTaken(displayName, active.map((m) => m.displayName))) {
    redirect(
      joinErrorUrl(
        clubId,
        `"${displayName}" is already in this club — pick that name above if it's you, ` +
          "or add yourself under a different name.",
      ),
    );
  }

  const [created] = await db
    .insert(memberships)
    .values({
      clubId,
      userId: null,
      identityKey: crypto.randomUUID(),
      displayName,
      role: "member",
    })
    .returning({ id: memberships.id });

  await setIdentityCookie(clubId, created.id);
  redirect(`/clubs/${clubId}`);
}
