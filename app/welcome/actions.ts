"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { invites, users } from "@/db/schema";
import { activeClubIdsByName, clashingClub } from "@/app/displayNameClash";
import { redeemDestination, redeemInvite } from "@/app/invites";
import { safePath } from "@/app/baseUrl";
import { discardNewAccount, recordConsent } from "@/app/consent";
import { clearSessionCookie, getSessionUserId } from "@/app/session";
import { clearFormEcho, setFormEcho } from "@/app/formEcho";
import { readConsentForm } from "@/lib/consent";
import { validateDisplayName } from "@/lib/displayName";

// The name step (docs/onboarding-spec.md §5.6), now with the consent
// controls (§11.1–§11.3): a display name (ruled 2026-11-25, u2), age, the
// Terms box, and for 18 or older the optional data-sharing box. Saved in
// one batch. Arriving from an invite, this is where they join: once the
// name is free in that club (and any they're already in), so a clash
// creates nothing. "Under 13" keeps nothing: the brand-new account is
// removed, and the person lands on a page that says why (§11.3).
export async function saveWelcome(formData: FormData) {
  const next = safePath(String(formData.get("next") ?? ""));
  const invite = String(formData.get("invite") ?? "");
  const typedName = String(formData.get("displayName") ?? "");

  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const userId = await getSessionUserId();
  if (!userId) redirect(`/login`);
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) redirect(`/login`);
  // Already named: this account isn't new, and isn't this form's.
  if (user.displayName) redirect(next);

  const consent = readConsentForm(
    { age: formData.get("age"), terms: formData.get("terms"), licensing: formData.get("licensing") },
    { age: !user.ageBracket, terms: true },
  );
  if (consent.kind === "under_13") {
    await discardNewAccount(db, userId);
    await clearSessionCookie();
    redirect("/age-limit");
  }

  // What was typed goes back through the form-echo cookie, never the URL
  // (§11.6); only the fixed message and the paths ride in it.
  // A clash names a person, so it rides in the cookie too (`takenIn`), with
  // only a flag in the URL.
  const back = async (problem: { error: string } | { takenIn: string; displayName: string }): Promise<never> => {
    const age = formData.get("age");
    await setFormEcho("/welcome", {
      displayName: "takenIn" in problem ? problem.displayName : typedName,
      ...("takenIn" in problem ? { takenIn: problem.takenIn } : {}),
      ...(typeof age === "string" && age ? { age } : {}),
    });
    const qs = new URLSearchParams({ next });
    if ("error" in problem) qs.set("error", problem.error);
    else qs.set("nameTaken", "1");
    if (invite) qs.set("invite", invite);
    redirect(`/welcome?${qs.toString()}`);
  };
  await clearFormEcho("/welcome");
  const name = validateDisplayName(typedName);
  if ("error" in name) return back({ error: name.error });
  if (consent.kind === "error") return back({ error: consent.error });
  if (consent.kind !== "ok") return;

  const [joining] = /^[0-9a-f-]{36}$/i.test(invite)
    ? await db.select({ id: invites.id, clubId: invites.clubId }).from(invites).where(eq(invites.id, invite))
    : [];
  const takenIn = await clashingClub(db, userId, name.displayName, [
    ...(joining ? [joining.clubId] : []),
    ...(await activeClubIdsByName(db, userId)),
  ]);
  if (takenIn) return back({ takenIn, displayName: name.displayName });

  await recordConsent(db, userId, { age: consent.age, licensing: consent.licensing, displayName: name.displayName });
  if (!joining) redirect(next);
  // An invited new account that's just joined goes on to the club's
  // welcome page (u3): add a few films before their first turn.
  const joined = await redeemInvite(db, joining.id, userId);
  redirect(joined.status === "joined" ? `/clubs/${joined.clubId}/welcome` : redeemDestination(joined));
}
