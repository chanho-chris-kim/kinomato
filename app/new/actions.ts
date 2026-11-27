"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { clubs, memberships } from "@/db/schema";
import { requireNamedUser } from "@/app/auth";
import { clearFormEcho, setFormEcho } from "@/app/formEcho";
import { readNewClubForm } from "@/lib/newClub";
import { START_CLUB_PATH } from "@/lib/steps";

// "Start your club" (docs/onboarding-spec.md §5.8; u4, §5.13): the club's
// details and every setting, read by lib/newClub.ts with the Members tab's
// own readers. The creator is the signed-in account, named already —
// requireNamedUser sends anyone else to /login or /welcome first, and so
// does the page. People are added afterwards, each with their own invite.
// A mistake goes back to the form with the message (CLAUDE.md's ?error=
// convention) and what was typed in the form-echo cookie; a DB failure
// still throws.
const FIELDS = [
  "name",
  "cadence",
  "defaultDay",
  "defaultTime",
  "timezone",
  "mode",
  "firstNightOn",
  "nomineesPerTurn",
  "lockTime",
  "confirmAt",
  "autoAdvance",
  "showVoteCounts",
] as const;

export async function createClub(formData: FormData) {
  const start = formData.get("start") === "1";
  const owner = await requireNamedUser(start ? START_CLUB_PATH : "/new");
  const fields = Object.fromEntries(FIELDS.map((key) => [key, formData.get(key)]));
  await clearFormEcho("/new");
  const result = readNewClubForm(fields, new Date());
  if (!result.ok) {
    const echo: Record<string, string> = {};
    for (const [key, value] of Object.entries(fields)) if (typeof value === "string") echo[key] = value;
    await setFormEcho("/new", echo);
    const qs = new URLSearchParams({ error: result.error });
    if (start) qs.set("start", "1");
    redirect(`/new?${qs.toString()}`);
  }

  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const clubId = crypto.randomUUID();
  // One batch: the club with its settings (and its getting-started list),
  // and its owner's membership. The owner's name is their account's.
  await db.batch([
    db.insert(clubs).values({ id: clubId, ...result.details, settings: result.settings }),
    db.insert(memberships).values({ clubId, userId: owner.id, role: "owner" }),
  ]);
  redirect(`/clubs/${clubId}`);
}
