import { inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { getDb } from "@/db";
import {
  clubs,
  constraints,
  invites,
  magicLinks,
  memberships,
  nights,
  nominations,
  ratings,
  ratingTags,
  rsvps,
  seasons,
  tags,
} from "@/db/schema";
import { deleteVotesAndVetoesOfClubs } from "@/app/clubs/[clubId]/historyRead";

type Db = ReturnType<typeof getDb>;

// Every row of a club with no active member left, in an order the foreign
// keys allow: account deletion of a club's last member (§11.4, ruled
// 2026-11-07), and a last member deleting the club from the Members tab
// (§5.10, ruled 2026-11-11). The recorded exception to "attribution is
// retained" (CLAUDE.md): with no member left, there's no one to audit for. Votes and vetoes go through the
// history-read module, the only code that touches them. A sign-in code
// started from one of the club's invites loses only its invite link:
// signing in still works, it just joins nothing.
export function clubDeletionStatements(db: Db, clubIds: string[]): BatchItem<"pg">[] {
  const clubNights = db.select({ id: nights.id }).from(nights).where(inArray(nights.clubId, clubIds));
  const clubRatings = db.select({ id: ratings.id }).from(ratings).where(inArray(ratings.nightId, clubNights));
  const clubMemberships = db
    .select({ id: memberships.id })
    .from(memberships)
    .where(inArray(memberships.clubId, clubIds));
  const clubInvites = db.select({ id: invites.id }).from(invites).where(inArray(invites.clubId, clubIds));
  return [
    ...deleteVotesAndVetoesOfClubs(db, clubIds),
    db.delete(ratingTags).where(inArray(ratingTags.ratingId, clubRatings)),
    db.delete(ratings).where(inArray(ratings.nightId, clubNights)),
    db.delete(rsvps).where(inArray(rsvps.nightId, clubNights)),
    db.delete(nominations).where(inArray(nominations.nightId, clubNights)),
    db.delete(nights).where(inArray(nights.clubId, clubIds)),
    db.delete(tags).where(inArray(tags.clubId, clubIds)),
    db.update(magicLinks).set({ inviteId: null }).where(inArray(magicLinks.inviteId, clubInvites)),
    db.delete(invites).where(inArray(invites.clubId, clubIds)),
    db.delete(constraints).where(inArray(constraints.membershipId, clubMemberships)),
    db.delete(memberships).where(inArray(memberships.clubId, clubIds)),
    db.delete(seasons).where(inArray(seasons.clubId, clubIds)),
    db.delete(clubs).where(inArray(clubs.id, clubIds)),
  ];
}
