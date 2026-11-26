import Link from "next/link";
import { addRatingTag, iWasThere, removeRatingTag, submitRating } from "../actions";
import { RatingSlider } from "../RatingSlider";
import { StageCard } from "./StageCard";

export interface RevealedRating {
  displayName: string;
  scoreQuality: string;
  scoreFun: string;
  hotTake: string | null;
  tags: { name: string; displayName: string }[];
}

// Rate (blind reveal, CLAUDE.md): one slider per score, its value beside
// the label (the Tonight redesign, ruled 2026-11-25).
export function RateForm({
  main,
  clubId,
  nightId,
  filmTitle,
  progress,
}: {
  main: boolean;
  clubId: string;
  nightId: string;
  filmTitle: string;
  progress: string | null;
}) {
  return (
    <StageCard main={main} id="rate" eyebrow={main ? "Your move" : "Rate"} title={`Rate ${filmTitle}`}>
      <p className="small muted mt-1">Everyone&apos;s ratings stay hidden until everyone who came has rated.</p>
      <form action={submitRating.bind(null, clubId, nightId)} className="stack gap14 mt14">
        <RatingSlider name="scoreQuality" label="Quality" />
        <RatingSlider name="scoreFun" label="Fun" />
        <label className="small muted">
          One-line take (optional)
          <div className="search mt-1">
            <input type="text" name="hotTake" maxLength={140} />
          </div>
        </label>
        <button type="submit" className={`btn ${main ? "primary" : ""}`}>
          Submit rating
        </button>
      </form>
      {progress && <p className="tiny dim mt14">{progress}</p>}
    </StageCard>
  );
}

// "I was there" (ruled 2026-11-24): someone who came without answering
// joins the rating step until the reveal.
export function IWasThereCard({
  main,
  clubId,
  nightId,
  filmTitle,
}: {
  main: boolean;
  clubId: string;
  nightId: string;
  filmTitle: string;
}) {
  return (
    <StageCard main={main} id="i-was-there" eyebrow={main ? "Your move" : "Rate"} title={`Were you there for ${filmTitle}?`}>
      <p className="small muted mt-1">Say so and you can rate it with everyone else.</p>
      <form action={iWasThere.bind(null, clubId, nightId)} className="mt14">
        <button type="submit" className={`btn ${main ? "primary" : ""}`}>
          I was there
        </button>
      </form>
      <p className="tiny dim mt14">Not there? Nothing to do.</p>
    </StageCard>
  );
}

// After you've rated: your tags, how many ratings are in, and everyone's
// once they're revealed.
export function YourRating({
  main,
  clubId,
  nightId,
  filmTitle,
  myTags,
  tagOptions,
  progress,
  revealed,
}: {
  main: boolean;
  clubId: string;
  nightId: string;
  filmTitle: string;
  myTags: { tagId: string; displayName: string }[];
  tagOptions: string[];
  progress: string | null;
  revealed: RevealedRating[] | null;
}) {
  return (
    <StageCard main={main} id="rate" eyebrow="Rate" title={`Rate ${filmTitle}`}>
      {/* Tags live on the rating row, so they can only be added once the
          rating exists (CLAUDE.md: tags alongside the hot take). */}
      <div className="mt14">
        <h3 className="sec">Your tags</h3>
        {myTags.length > 0 && (
          <ul className="row gap8 mt-1 wrap plain-list">
            {myTags.map((t) => (
              <li key={t.tagId} className="chip">
                {t.displayName}{" "}
                <form action={removeRatingTag.bind(null, clubId, nightId, t.tagId)} className="inline">
                  <button type="submit" className="underline tap" aria-label={`Remove ${t.displayName}`}>
                    remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={addRatingTag.bind(null, clubId, nightId)} className="row gap8 mt14">
          <div className="search grow">
            <input type="text" name="tag" aria-label="Add a tag" list="club-tag-options" placeholder="Add a tag" maxLength={50} />
          </div>
          <datalist id="club-tag-options">
            {tagOptions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <button type="submit" className="btn auto">
            Add tag
          </button>
        </form>
      </div>
      {progress && <p className="tiny dim mt14">{progress}</p>}
      {revealed && <RevealedRatings ratings={revealed} clubId={clubId} />}
    </StageCard>
  );
}

// Once every rating is in: everyone sees them, rater or not.
export function ClubRatings({
  main,
  clubId,
  filmTitle,
  ratings,
}: {
  main: boolean;
  clubId: string;
  filmTitle: string;
  ratings: RevealedRating[];
}) {
  return (
    <StageCard main={main} id="club-ratings" eyebrow="Ratings" title={`How the club rated ${filmTitle}`}>
      <RevealedRatings ratings={ratings} clubId={clubId} />
    </StageCard>
  );
}

function RevealedRatings({ ratings, clubId }: { ratings: RevealedRating[]; clubId: string }) {
  return (
    <ul className="stack gap8 mt14 plain-list">
      {ratings.map((r, i) => (
        <li key={i} className="card">
          <div className="between">
            <span className="small">{r.displayName}</span>
            <span className="tiny">
              <span className="muted">quality {r.scoreQuality}</span>, <span className="you">fun {r.scoreFun}</span>
            </span>
          </div>
          {r.hotTake && <p className="small muted mt-1 take">&quot;{r.hotTake}&quot;</p>}
          {r.tags.length > 0 && (
            <div className="row gap8 mt-1 wrap">
              {r.tags.map((t) => (
                <Link key={t.name} href={`/clubs/${clubId}/tags/${encodeURIComponent(t.name)}`} className="chip">
                  {t.displayName}
                </Link>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
