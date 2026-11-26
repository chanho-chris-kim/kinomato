import { setRsvp } from "../actions";

// "Coming Saturday?" (the Tonight redesign, ruled 2026-11-25): below the
// do-this-now card, while the night hasn't started (ruled 2026-11-24).
// Outlined buttons; the current answer is pressed and ticked. After lock
// an answer still changes, but never the pick (CLAUDE.md lock ruling).
export function RsvpCard({
  clubId,
  nightId,
  weekday,
  status,
  locked,
}: {
  clubId: string;
  nightId: string;
  weekday: string;
  status: "yes" | "no" | null;
  locked: boolean;
}) {
  return (
    <section className="card mt14 rsvp-card" aria-labelledby="rsvp-heading">
      <h2 id="rsvp-heading" className="sec">
        Coming {weekday}?
      </h2>
      <div className="row gap8">
        <form action={setRsvp.bind(null, clubId, nightId, "yes")} className="grow">
          <button type="submit" className="btn answer" aria-pressed={status === "yes"}>
            Going{status === "yes" && <span aria-hidden="true"> ✓</span>}
          </button>
        </form>
        <form action={setRsvp.bind(null, clubId, nightId, "no")} className="grow">
          <button type="submit" className="btn answer" aria-pressed={status === "no"}>
            Not going{status === "no" && <span aria-hidden="true"> ✓</span>}
          </button>
        </form>
      </div>
      <p className="tiny dim mt-1">
        {status === null ? "You haven't answered yet." : locked ? "Changing it won't change the pick." : "You can change it until the night starts."}
      </p>
    </section>
  );
}
