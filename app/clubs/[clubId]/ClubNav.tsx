import Link from "next/link";

// Minimal persistent nav for every club-scoped route once someone has
// an identity — there was no way back from the watchlist to the club
// page before this. Provides the page's own <h1> (a link to the club
// home) so neither page needs its own separate heading.
export function ClubNav({
  clubId,
  clubName,
  current,
}: {
  clubId: string;
  clubName: string;
  current: "club" | "watchlist";
}) {
  return (
    <div className="pb-2 mb-4 border-b flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <h1 className="text-xl font-bold">
        <Link href={`/clubs/${clubId}`} className="underline">
          {clubName}
        </Link>
      </h1>
      <nav className="flex gap-3 text-sm">
        {current === "club" ? (
          <span className="font-semibold">Club</span>
        ) : (
          <Link href={`/clubs/${clubId}`} className="underline">
            Club
          </Link>
        )}
        {current === "watchlist" ? (
          <span className="font-semibold">Watchlist</span>
        ) : (
          <Link href={`/clubs/${clubId}/list`} className="underline">
            Watchlist
          </Link>
        )}
      </nav>
    </div>
  );
}
