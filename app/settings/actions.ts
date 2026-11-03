"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { endSession } from "@/app/session";

// Signs this browser out: its session row is deleted and the cookie
// cleared (app/session.ts). "Sign out everywhere" is step 7.
export async function signOut() {
  await endSession(getDb());
  redirect("/");
}
