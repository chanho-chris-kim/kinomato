"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { clubs, memberships } from "@/db/schema";
import { requireNamedUser } from "@/app/auth";

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

// Four questions (docs/onboarding-spec.md §5.8): name, cadence, day and
// time, in person or remote. The creator is the signed-in account, named
// already — requireNamedUser sends anyone else to /login or /welcome
// first, and so does the page. People are added afterwards, each with
// their own invite, from the club page.
export async function createClub(formData: FormData) {
  const owner = await requireNamedUser("/new");
  const name = String(formData.get("name") ?? "").trim();
  const cadence = String(formData.get("cadence") ?? "");
  const defaultDay = Number(formData.get("defaultDay"));
  const defaultTime = String(formData.get("defaultTime") ?? "");
  const timezone = String(formData.get("timezone") ?? "").trim();
  const mode = String(formData.get("mode") ?? "");

  // Validation failures redirect back to the form with a readable
  // message in a query param rather than throwing — a thrown error in a
  // plain <form action> has no error boundary to land in here, and a
  // scary dev-overlay is a worse "clear message" than the one the free-
  // tier cap explicitly asked for. Genuine bugs (a DB write failing)
  // still throw; this is only for expected, user-facing input problems.
  if (!name) redirect("/new?error=" + encodeURIComponent("Club name is required."));

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

  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const clubId = crypto.randomUUID();

  // One batch (one Postgres transaction). invite_token and the
  // membership's identity_key/display_name are no longer read by anything
  // — per-person invites, carry-forward by user_id, names from users — but
  // the old schema still requires them until rebuild step 4b drops them.
  await db.batch([
    db.insert(clubs).values({
      id: clubId,
      inviteToken: crypto.randomUUID(),
      name,
      cadence,
      defaultDay,
      defaultTime,
      timezone,
      mode,
    }),
    db.insert(memberships).values({
      clubId,
      userId: owner.id,
      identityKey: owner.id,
      displayName: owner.displayName,
      role: "owner",
    }),
  ]);

  redirect(`/clubs/${clubId}`);
}
