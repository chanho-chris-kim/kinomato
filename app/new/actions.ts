"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { clubs, memberships } from "@/db/schema";
import { FREE_TIER_MEMBER_CAP } from "@/lib/clubMembers";
import { identityCookieName } from "@/app/clubs/[clubId]/identity";

const CADENCES = ["weekly", "biweekly", "monthly", "ad_hoc"] as const;
const MODES = ["in_person", "remote"] as const;

function isCadence(value: string): value is (typeof CADENCES)[number] {
  return (CADENCES as readonly string[]).includes(value);
}

function isMode(value: string): value is (typeof MODES)[number] {
  return (MODES as readonly string[]).includes(value);
}

// Fails loud on a bad config value rather than silently accepting
// garbage — same posture as CLAUDE.md's missing-data ruling for system
// configuration, extended to the one free-text field on this form.
function isSupportedTimeZone(value: string): boolean {
  try {
    return Intl.supportedValuesOf("timeZone").includes(value);
  } catch {
    return false;
  }
}

// analysis-v1.md §1.1 stage 2: "Name, cadence, day and time, and
// in-person or remote. Four questions, one screen. Notably absent:
// account creation." The creator's own name is a fifth, practically
// required field — CLAUDE.md's Build order note "the creator becomes
// owner and gets an identity cookie immediately" needs a display name
// to attach that identity to, so this can't be inferred from nothing.
//
// Pre-added member names (stage 3: "the club already populated with the
// founder's name") are plain placeholder membership rows with a freshly
// minted identityKey and no cookie attached yet — claiming one at
// /clubs/[clubId]/join is the exact same "pick a name, set a cookie"
// mechanism already used everywhere else in this app (pickIdentity).
// There's no verification that the right person claims the right name;
// that's the accepted v0 auth model, not a gap specific to this screen.
export async function createClub(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const yourName = String(formData.get("yourName") ?? "").trim();
  const cadence = String(formData.get("cadence") ?? "");
  const defaultDay = Number(formData.get("defaultDay"));
  const defaultTime = String(formData.get("defaultTime") ?? "");
  const timezone = String(formData.get("timezone") ?? "").trim();
  const mode = String(formData.get("mode") ?? "");
  const memberNamesRaw = String(formData.get("memberNames") ?? "");

  // Validation failures redirect back to the form with a readable
  // message in a query param rather than throwing — a thrown error in a
  // plain <form action> has no error boundary to land in here, and a
  // scary dev-overlay is a worse "clear message" than the one the free-
  // tier cap explicitly asked for. Genuine bugs (a DB write failing)
  // still throw; this is only for expected, user-facing input problems.
  if (!name) redirect("/new?error=" + encodeURIComponent("Club name is required."));
  if (!yourName) redirect("/new?error=" + encodeURIComponent("Your name is required."));
  if (!isCadence(cadence)) {
    redirect("/new?error=" + encodeURIComponent("Pick a valid cadence."));
  }
  if (!isMode(mode)) {
    redirect("/new?error=" + encodeURIComponent("Pick in-person or remote."));
  }
  if (!Number.isInteger(defaultDay) || defaultDay < 0 || defaultDay > 6) {
    redirect("/new?error=" + encodeURIComponent("Pick a day of the week."));
  }
  if (!defaultTime) {
    redirect("/new?error=" + encodeURIComponent("A default time is required."));
  }
  if (!timezone || !isSupportedTimeZone(timezone)) {
    redirect(
      "/new?error=" +
        encodeURIComponent(`"${timezone}" isn't a recognized timezone, e.g. "America/New_York".`),
    );
  }

  // Silently deduped, not rejected — this is the owner tidying their
  // own input (a repeated line), not a joiner contesting an identity,
  // which is the scenario that gets a hard error instead (see
  // join/actions.ts's isDisplayNameTaken check).
  const seen = new Set([yourName.toLowerCase()]);
  const memberNames: string[] = [];
  for (const raw of memberNamesRaw.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    memberNames.push(trimmed);
  }

  const totalMembers = 1 + memberNames.length; // 1 = the owner
  if (totalMembers > FREE_TIER_MEMBER_CAP) {
    redirect(
      "/new?error=" +
        encodeURIComponent(
          `The free tier caps a club at ${FREE_TIER_MEMBER_CAP} members. ` +
            `That's you plus ${FREE_TIER_MEMBER_CAP - 1} others — trim the list by ` +
            `${totalMembers - FREE_TIER_MEMBER_CAP}.`,
        ),
    );
  }

  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const clubId = crypto.randomUUID();
  const ownerMembershipId = crypto.randomUUID();

  // All these inserts ride in one db.batch() (one Postgres transaction),
  // and defaultNow() resolves to the transaction's start time — every
  // row would otherwise get an *identical* joined_at, leaving rotation
  // order's joined_at-ASC tiebreak to fall through to id (a random
  // UUID), which could hand the very first pick to someone other than
  // the owner. Stamped explicitly instead, one millisecond apart in
  // creation order, so the owner is deterministically first.
  const baseJoinedAt = Date.now();
  const joinedAtFor = (index: number) => new Date(baseJoinedAt + index);

  await db.batch([
    db.insert(clubs).values({
      id: clubId,
      name,
      cadence,
      defaultDay,
      defaultTime,
      timezone,
      mode,
    }),
    db.insert(memberships).values({
      id: ownerMembershipId,
      clubId,
      userId: null,
      identityKey: crypto.randomUUID(),
      displayName: yourName,
      role: "owner",
      joinedAt: joinedAtFor(0),
    }),
    ...memberNames.map((displayName, index) =>
      db.insert(memberships).values({
        id: crypto.randomUUID(),
        clubId,
        userId: null,
        identityKey: crypto.randomUUID(),
        displayName,
        role: "member",
        joinedAt: joinedAtFor(index + 1),
      }),
    ),
  ]);

  const cookieStore = await cookies();
  cookieStore.set(identityCookieName(clubId), ownerMembershipId, {
    httpOnly: true,
    sameSite: "lax",
    path: `/clubs/${clubId}`,
  });

  redirect(`/clubs/${clubId}`);
}
