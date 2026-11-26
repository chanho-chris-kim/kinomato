import Link from "next/link";
import { addToWatchlist } from "@/app/watchlist/actions";
import { openVoting, passMyTurn, passTurnFor } from "../actions";
import { NominationSelector, type NominableFilm } from "../NominationSelector";
import { buttonClass, StageCard } from "./StageCard";

// Nominate (a draft night). The picker gets the films they can nominate as
// poster cards; everyone else sees who the club is waiting on, and an
// owner or admin can pass that turn (ruled 2026-11-17).
export function PickerNominate({
  main,
  clubId,
  nightId,
  closesLabel,
  films,
  listIsEmpty,
  cap,
  helpFilms,
  passConfirm,
}: {
  main: boolean;
  clubId: string;
  nightId: string;
  // When voting would close if opened now: the draft's own deadline.
  closesLabel: string | null;
  films: NominableFilm[];
  listIsEmpty: boolean;
  cap: number;
  helpFilms: { id: string; tmdbId: number; title: string; year: number; othersWant: number }[];
  passConfirm: boolean;
}) {
  return (
    <StageCard main={main} id="nominate" eyebrow={main ? "Your move" : "Your turn this week"} title="Your turn to nominate">
      <p className="small muted mt-1">
        Choose the films the club votes on{closesLabel ? `, by ${closesLabel}` : ""}.
      </p>
      {/* Always shown, filtered or not (ruled 2026-11-13), so it never
          signals that something in particular was hidden. */}
      <p className="tiny dim mt-1 fit-note">Only films that fit everyone in this club are shown here.</p>
      {films.length === 0 && !listIsEmpty ? (
        // Every film on the list is out for this club (ruled 2026-11-12): no
        // count, no reason, no limit, no person.
        <p className="small muted mt14 empty-pool">
          None of your watchlist fits this club right now.{" "}
          <Link href="/watchlist" className="underline">
            Add a few more films.
          </Link>
        </p>
      ) : films.length === 0 ? (
        <p className="small muted mt14">
          Your watchlist is empty.{" "}
          <Link href="/watchlist" className="underline">
            Add films to it
          </Link>{" "}
          before you can nominate.
        </p>
      ) : (
        <form action={openVoting.bind(null, clubId, nightId)} className="mt14">
          <NominationSelector films={films} cap={cap} primary={main} />
        </form>
      )}
      {helpFilms.length > 0 && (
        // Films your club wants that fit everyone (ruled 2026-11-17): counts,
        // never names, and nothing says why other films aren't here.
        <section className="mt20 help-films" aria-labelledby="help-films-heading">
          <h3 id="help-films-heading" className="sec">
            Films your club wants that fit everyone
          </h3>
          <ul className="stack gap8 mt14 plain-list">
            {helpFilms.map((f) => (
              <li key={f.id} className="card row gap8">
                <div className="grow">
                  <span className="small">
                    {f.title} ({f.year})
                  </span>
                  <p className="tiny dim flush">
                    {f.othersWant} {f.othersWant === 1 ? "other wants" : "others want"} this
                  </p>
                </div>
                <form action={addToWatchlist.bind(null, f.tmdbId)}>
                  <button type="submit" className="btn ghost limit-remove" aria-label={`Add ${f.title} to my list`}>
                    Add to my list
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
      {/* Pass my turn (ruled 2026-11-17): only while the night is a draft.
          Two taps: the link opens the confirm. */}
      {passConfirm ? (
        <div className="card mt14 pass-confirm">
          <p className="small flush">
            Pass your turn? The next person picks this time, and you&apos;ll pick the time after.
          </p>
          <div className="row gap8 mt14">
            <form action={passMyTurn.bind(null, clubId)}>
              <button type="submit" className="btn auto">
                Pass my turn
              </button>
            </form>
            <Link href={`/clubs/${clubId}`} className="btn ghost auto">
              Cancel
            </Link>
          </div>
        </div>
      ) : (
        <p className="small mt14">
          <Link href={`/clubs/${clubId}?pass=1`} className="underline tap">
            Pass my turn
          </Link>
        </p>
      )}
    </StageCard>
  );
}

export function WaitingOnPicker({
  main,
  clubId,
  pickerName,
  pickerMembershipId,
  canPassFor,
  passConfirm,
}: {
  main: boolean;
  clubId: string;
  pickerName: string;
  pickerMembershipId: string;
  // An owner or admin, and the picker is still a member.
  canPassFor: boolean;
  passConfirm: boolean;
}) {
  return (
    <StageCard main={main} id="waiting" eyebrow="Nominate" title={`${pickerName} is picking`}>
      <p className="small muted mt-1">Waiting on {pickerName} to nominate.</p>
      {canPassFor &&
        (passConfirm ? (
          <div className="card mt14 pass-confirm">
            <p className="small flush">
              Pass {pickerName}&apos;s turn? The next person picks this time, and {pickerName} picks the time after.
            </p>
            <div className="row gap8 mt14">
              <form action={passTurnFor.bind(null, clubId, pickerMembershipId)}>
                <button type="submit" className={buttonClass(main, "auto")}>
                  Pass {pickerName}&apos;s turn
                </button>
              </form>
              <Link href={`/clubs/${clubId}`} className="btn ghost auto">
                Cancel
              </Link>
            </div>
          </div>
        ) : (
          <p className="small mt14">
            <Link href={`/clubs/${clubId}?passFor=1`} className="underline tap">
              Pass {pickerName}&apos;s turn
            </Link>
          </p>
        ))}
    </StageCard>
  );
}
