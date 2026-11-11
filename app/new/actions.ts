"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { clubs, memberships } from "@/db/schema";
import { requireNamedUser } from "@/app/auth";
import { readClubDetailsForm } from "@/lib/clubDetails";

// Four questions (docs/onboarding-spec.md §5.8): name, cadence, day and
// time, in person or remote. The creator is the signed-in account, named
// already — requireNamedUser sends anyone else to /login or /welcome
// first, and so does the page. People are added afterwards, each with
// their own invite, from the club page.
export async function createClub(formData: FormData) {
  const owner = await requireNamedUser("/new");
  // Validation (lib/clubDetails.ts, shared with the Members tab's edit
  // form) failures redirect back to the form with a readable message in a
  // query param rather than throwing — a thrown error in a plain <form
  // action> has no error boundary to land in here, and a scary dev-overlay
  // is a worse "clear message" than the one the free-tier cap explicitly
  // asked for. Genuine bugs (a DB write failing) still throw; this is only
  // for expected, user-facing input problems.
  const result = readClubDetailsForm(
    {
      name: formData.get("name"),
      cadence: formData.get("cadence"),
      defaultDay: formData.get("defaultDay"),
      defaultTime: formData.get("defaultTime"),
      timezone: formData.get("timezone"),
      mode: formData.get("mode"),
    },
    { allowAdHoc: true },
  );
  if (!result.ok) redirect("/new?error=" + encodeURIComponent(result.error));
  const { name, cadence, defaultDay, defaultTime, timezone, mode } = result.details;

  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const clubId = crypto.randomUUID();

  // One batch (one Postgres transaction): the club, and its owner's
  // membership. The owner's name is their account's.
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
      clubId,
      userId: owner.id,
      role: "owner",
    }),
  ]);

  redirect(`/clubs/${clubId}`);
}
