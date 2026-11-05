import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { clubs } from "@/db/schema";
import { requireClubMember } from "@/app/auth";
import { ClubHeader, ClubTabs, GlobalShell } from "@/app/shell";
import { clubHistory, type HistoryNight } from "../historyRead";
import { byJoinedAt, RailMembers } from "../memberViews";
import { loadClubMemberships } from "../members";

// The History tab (docs/onboarding-spec.md §5.10; rebuild step 5f). Every
// member sees the same record (CLAUDE.md "History is shared and
// symmetric"): each finished night's date, film, picker, state, final
// tally, how many vetoes, ratings once revealed, and who came. Never who
// voted for what, never who vetoed, never a per-member total. Everything
// here comes through the history-read module, which can't return voters.
export default async function HistoryPage({ params }: { params: Promise<{ clubId: string }> }) {
  const { clubId } = await params;
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const { membership: me } = await requireClubMember(clubId, `/clubs/${clubId}/history`);
  const [[club], members, history] = await Promise.all([
    db.select().from(clubs).where(eq(clubs.id, clubId)),
    loadClubMemberships(db, clubId),
    clubHistory(db, clubId),
  ]);
  const active = members.filter((m) => m.leftAt === null).sort(byJoinedAt);
  const canAdd = me.role === "owner" || me.role === "admin";

  return (
    <GlobalShell
      current="clubs"
      header={
        <>
          <ClubHeader club={club} />
          <ClubTabs clubId={clubId} current="history" />
        </>
      }
      rail={
        <RailMembers
          members={active}
          meId={me.id}
          addPersonHref={canAdd ? `/clubs/${clubId}/members#add-person` : undefined}
        />
      }
    >
      {history.nights.length === 0 ? (
        <div className="empty mt20">
          No nights yet. Your club&apos;s first movie night will show up here once it&apos;s done.
        </div>
      ) : (
        <ol className="stack gap8 mt14" style={{ listStyle: "none", padding: 0 }}>
          {history.nights.map((night) => (
            <HistoryEntry key={night.nightId} night={night} clubId={clubId} timezone={history.timezone} />
          ))}
        </ol>
      )}
    </GlobalShell>
  );
}

const STATE_LABEL: Record<HistoryNight["state"], string | null> = {
  watched: null,
  cancelled: "Cancelled",
  unconfirmed: "Unconfirmed",
};

function HistoryEntry({ night, clubId, timezone }: { night: HistoryNight; clubId: string; timezone: string }) {
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(night.scheduledAt);
  const label = STATE_LABEL[night.state];

  return (
    <li className="card history-night">
      <div className="between" style={{ alignItems: "baseline", gap: 12 }}>
        <span className="tiny dim">{date}</span>
        {label && <span className="pill">{label}</span>}
      </div>
      <h2 className="h-display mt-1" style={{ fontSize: 20 }}>
        {night.state === "watched" && night.film
          ? night.film.title
          : night.state === "cancelled"
            ? "We didn't meet"
            : night.film
              ? night.film.title
              : "No pick"}
        {night.state === "watched" && night.film && (
          <span className="small dim" style={{ fontFamily: "inherit" }}>
            {" "}
            ({night.film.year})
          </span>
        )}
      </h2>
      <p className="small muted" style={{ margin: "4px 0 0" }}>
        {night.pickerName}&apos;s pick
        {night.state === "cancelled" && night.film && `, ${night.film.title}`}
        {night.state === "unconfirmed" && ". Nobody confirmed whether the club watched it."}
      </p>

      {night.tally.length > 0 && (
        <div className="mt14">
          <h3 className="tiny dim" style={{ margin: 0 }}>
            Final vote
          </h3>
          <ul className="tally" style={{ listStyle: "none", padding: 0, margin: "4px 0 0" }}>
            {night.tally.map((row) => (
              <li key={row.title} className="between small">
                <span>
                  {row.title} <span className="dim">({row.year})</span>
                  {row.winner && <span className="you"> · picked</span>}
                </span>
                <span>
                  {row.count} {row.count === 1 ? "vote" : "votes"}
                </span>
              </li>
            ))}
          </ul>
          {night.vetoCount > 0 && (
            <p className="tiny dim" style={{ margin: "4px 0 0" }}>
              {night.vetoCount} {night.vetoCount === 1 ? "veto" : "vetoes"}
            </p>
          )}
        </div>
      )}

      {night.state === "watched" && (
        <p className="small mt14" style={{ margin: "14px 0 0" }}>
          <span className="dim">Came: </span>
          {night.attendees.length > 0 ? night.attendees.join(", ") : "nobody said yes"}
        </p>
      )}

      {night.ratings &&
        (night.ratings.revealed ? (
          night.ratings.ratings.length > 0 && (
            <ul className="stack gap8 mt14" style={{ listStyle: "none", padding: 0 }}>
              {night.ratings.ratings.map((r, i) => (
                <li key={i} className="rating">
                  <div className="between">
                    <span className="small">{r.raterName}</span>
                    <span className="tiny">
                      <span className="muted">quality {r.scoreQuality}</span>,{" "}
                      <span style={{ color: "var(--accent)" }}>fun {r.scoreFun}</span>
                    </span>
                  </div>
                  {r.hotTake && (
                    <p className="small muted" style={{ margin: "2px 0 0", fontStyle: "italic" }}>
                      &quot;{r.hotTake}&quot;
                    </p>
                  )}
                  {r.tags.length > 0 && (
                    <div className="row gap8 mt-1" style={{ flexWrap: "wrap" }}>
                      {r.tags.map((t) => (
                        <Link
                          key={t.name}
                          href={`/clubs/${clubId}/tags/${encodeURIComponent(t.name)}`}
                          className="chip"
                        >
                          {t.displayName}
                        </Link>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )
        ) : (
          <p className="tiny dim mt14">Ratings are hidden until everyone who came has rated.</p>
        ))}
    </li>
  );
}
