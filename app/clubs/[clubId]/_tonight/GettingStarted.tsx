import Link from "next/link";
import { FILMS_TO_ADD, type GettingStartedKey } from "@/lib/gettingStarted";
import { gettingStartedLooksGood, hideGettingStarted } from "../actions";
import { StageCard } from "./StageCard";

// "Get {club} going" (u4, §5.13): the owner's checklist on Tonight, the
// page's "do this now" card while it shows. The current item (the first not
// done) carries the card's one filled button; done items are ticked and
// struck through.
export function GettingStarted({
  clubId,
  clubName,
  items,
  seatsLeft,
  ownFilms,
  firstNight,
}: {
  clubId: string;
  clubName: string;
  items: { key: GettingStartedKey; done: boolean }[];
  seatsLeft: number;
  ownFilms: number;
  // A club with no night yet or only its first draft.
  firstNight: { date: string; time: string } | null;
}) {
  const done = items.filter((i) => i.done).length;
  const current = items.find((i) => !i.done)?.key;
  const action = (key: GettingStartedKey) => `btn auto ${key === current ? "primary" : ""}`.trim();
  const text: Record<GettingStartedKey, { title: string; note?: string; cta?: { href: string; label: string } }> = {
    create: { title: "Create your club" },
    invite: {
      title: "Invite your people",
      note: `Up to ${seatsLeft} more. Each gets their own link.`,
      cta: { href: `/clubs/${clubId}/members/invite`, label: "Invite people" },
    },
    films: {
      title: `Add at least ${FILMS_TO_ADD} films to your watchlist`,
      note: `${Math.min(ownFilms, FILMS_TO_ADD)} of ${FILMS_TO_ADD} added.`,
      cta: { href: "/watchlist", label: "Add films" },
    },
    check: {
      title: "Check how the club runs",
      note: "Voting, reminders and when we ask if you watched it.",
      cta: { href: `/clubs/${clubId}/members#club-settings`, label: "See how it runs" },
    },
  };

  return (
    <>
      <StageCard main id="getting-started" eyebrow="Your club is ready" title={`Get ${clubName} going`} className="getting-started">
        <p className="small muted mt-1 checklist-count">
          {done} of {items.length} done. This list goes away once you&apos;re set.
        </p>
        <ol className="plain-list checklist mt14">
          {items.map((item) => {
            const t = text[item.key];
            return (
              <li key={item.key} className={`checklist-item ${item.done ? "done" : ""} ${item.key === current ? "current" : ""}`}>
                <span className="checklist-mark" aria-hidden="true">
                  {item.done ? "✓" : ""}
                </span>
                <div className="grow">
                  <p className="small flush checklist-title">
                    {t.title}
                    {item.done && <span className="sr-only"> (done)</span>}
                  </p>
                  {!item.done && t.note && <p className="tiny dim flush">{t.note}</p>}
                  {!item.done && t.cta && (
                    <div className="row gap8 mt-1 wrap">
                      {item.key === "check" ? (
                        <>
                          <Link href={t.cta.href} className="btn ghost auto">
                            {t.cta.label}
                          </Link>
                          <form action={gettingStartedLooksGood.bind(null, clubId)}>
                            <button type="submit" className={action("check")}>
                              Looks good
                            </button>
                          </form>
                        </>
                      ) : (
                        <Link href={t.cta.href} className={action(item.key)}>
                          {t.cta.label}
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        <form action={hideGettingStarted.bind(null, clubId)} className="mt14">
          <button type="submit" className="underline tap small hide-checklist">
            Hide this list
          </button>
        </form>
      </StageCard>
      {firstNight && (
        <p className="small muted mt14 first-night-note">
          Your first night: {firstNight.date} at {firstNight.time}. You pick first, since you started the club.
        </p>
      )}
    </>
  );
}
