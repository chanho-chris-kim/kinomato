"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { requireUser } from "@/app/auth";
import { clearFormEcho, setFormEcho } from "@/app/formEcho";
import { askToJoin, cancelJoinRequest, lookUpJoinCode } from "@/app/joinRequests";
import { normaliseJoinCode } from "@/lib/joinCode";

// /join's three actions (u5). The code never rides in a URL: it goes
// back and forth in the form-echo cookie and the form itself (§11.6). A
// message can name a club, so it does too, with only ?error=1 in the URL.
const back = async (values: Record<string, string>, query: string) => {
  await setFormEcho("/join", values);
  redirect(`/join?${query}`);
};

// "Ask to join" with a code typed: one try (ten wrong an hour). A right
// code shows the club's name and "Ask to join {club}" next.
export async function lookUpCodeAction(formData: FormData) {
  const user = await requireUser("/join");
  const typed = String(formData.get("code") ?? "");
  await clearFormEcho("/join");
  const found = await lookUpJoinCode(getDb(), user.id, typed, new Date());
  if (!found.ok) return back({ code: typed, error: found.error }, "error=1");
  if (found.alreadyMember) redirect(`/join?in=${found.club.id}`);
  return back({ code: normaliseJoinCode(typed)!, clubId: found.club.id }, "confirm=1");
}

// "Ask to join {club}": the request itself.
export async function askToJoinAction(formData: FormData) {
  const user = await requireUser("/join");
  const code = String(formData.get("code") ?? "");
  await clearFormEcho("/join");
  const result = await askToJoin(getDb(), user.id, code, new Date());
  if ("alreadyIn" in result) redirect(`/join?in=${result.alreadyIn.id}`);
  if (!result.ok) return back({ error: result.error }, "error=1");
  redirect(`/join?sent=${result.requestId}`);
}

export async function cancelJoinRequestAction(requestId: string) {
  const user = await requireUser("/join");
  await cancelJoinRequest(getDb(), user.id, requestId, new Date());
  redirect("/join?cancelled=1");
}
