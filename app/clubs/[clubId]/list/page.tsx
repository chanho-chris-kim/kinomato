import { redirect } from "next/navigation";
import { requireClubMember } from "@/app/auth";

// The club-scoped watchlist is retired (rebuild step 6d): the watchlist is
// one list per person, at /watchlist (docs/onboarding-spec.md §6). Old
// links and bookmarks land there, keeping a search (Seen from is gone,
// 2026-11-24, so there's no club to preset). The gate comes
// first, unchanged: signed out → /login, not an active member → 404. Only a
// member is redirected, so the redirect never confirms a club exists.
export default async function RetiredClubList({
  params,
  searchParams,
}: {
  params: Promise<{ clubId: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { clubId } = await params;
  const { q } = await searchParams;
  await requireClubMember(clubId, `/clubs/${clubId}/list`);
  redirect(q ? `/watchlist?${new URLSearchParams({ q })}` : "/watchlist");
}
