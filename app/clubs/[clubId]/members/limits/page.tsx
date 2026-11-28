import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { clubs, constraints } from "@/db/schema";
import { requireClubMember } from "@/app/auth";
import {
  describeLimit,
  describeLimitValue,
  HARD_LIMIT_CAP_MESSAGE,
  LIMIT_KIND_WORDS,
  MAX_RUNTIME_LIMIT,
  MIN_RUNTIME_LIMIT,
  MOVIE_GENRES,
} from "@/lib/constraintForm";
import { CONTENT_TOPICS } from "@/lib/contentTopics";
import { canAddHardLimit, HARD_LIMIT_CAP } from "@/lib/constraints";
import { addLimit, removeLimit, setLimitsApplyWhenAbsent } from "../../actions";
import { MembersFrame } from "../membersFrame";

// Your limits in this club (u6, ruled 2026-11-27; the rules ruled
// 2026-11-12): the viewer's own, seen and changed by nobody else, so
// nothing here loads anyone else's. "Never" is a hard limit, "Rather not" a
// soft preference; only the words changed. Same actions and validation as
// before (lib/constraintForm.ts), which act on the signed-in person only.
export default async function LimitsPage({
  params,
  searchParams,
}: {
  params: Promise<{ clubId: string }>;
  searchParams: Promise<{ limits?: string; limitsError?: string }>;
}) {
  const { clubId } = await params;
  const { limits, limitsError } = await searchParams;
  const db = getDb(); // request-scoped (React cache()) — see db/index.ts
  const { membership: me } = await requireClubMember(clubId, `/clubs/${clubId}/members/limits`);
  const [[club], myLimits] = await Promise.all([
    db.select().from(clubs).where(eq(clubs.id, clubId)),
    db
      .select()
      .from(constraints)
      .where(eq(constraints.membershipId, me.id))
      .orderBy(asc(constraints.kind), asc(constraints.ruleType), asc(constraints.value)),
  ]);
  const hardUsed = myLimits.filter((c) => c.kind === "hard").length;
  const atHardCap = !canAddHardLimit(myLimits);
  const appliesWhenAbsent = myLimits.some((c) => c.appliesWhenAbsent);

  return (
    <MembersFrame db={db} club={club} role={me.role}>
      <h2 className="h-display stage-title mt14 page-title">Your limits in {club.name}</h2>
      <p className="small muted mt-1 lock-line">
        <span aria-hidden="true">🔒 </span>Only you see these. Nobody is told why a film is missing.
      </p>
      {limitsError && (
        <p className="small mt14 warn" role="alert">
          {limitsError}
        </p>
      )}
      {limits === "saved" && !limitsError && (
        <p className="small mt14 saved-note" role="status">
          Saved.
        </p>
      )}

      {myLimits.length === 0 ? (
        <p className="small muted mt14">No limits set for this club.</p>
      ) : (
        <ul className="plain-list stack gap8 mt14 my-limits">
          {myLimits.map((c) => (
            <li key={c.id} className={`card limit-card ${c.kind}`}>
              <span className="grow">
                <span className={`chip ${c.kind === "hard" ? "on" : ""}`}>{LIMIT_KIND_WORDS[c.kind].label}</span>
                <span className="small limit-value">{describeLimitValue(c)}</span>
              </span>
              <form action={removeLimit.bind(null, clubId, c.id)}>
                <button type="submit" className="btn ghost auto limit-remove" aria-label={`Remove ${describeLimit(c)}`}>
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <section className="card mt20" aria-labelledby="add-limit-heading">
        <h2 id="add-limit-heading" className="sec flush">
          Add a limit
        </h2>
        <form action={addLimit.bind(null, clubId)} className="limit-form stack gap14 mt14">
          <fieldset className="choice-cards">
            <legend className="small muted">How strict?</legend>
            <label className={`choice-card ${atHardCap ? "disabled" : ""}`}>
              <input type="radio" name="kind" value="hard" defaultChecked={!atHardCap} disabled={atHardCap} />
              <span>
                <span className="choice-card-title">{LIMIT_KIND_WORDS.hard.label}</span>
                <span className="tiny dim choice-card-note">
                  {LIMIT_KIND_WORDS.hard.explain} {hardUsed} of {HARD_LIMIT_CAP} used.
                </span>
              </span>
            </label>
            <label className="choice-card">
              <input type="radio" name="kind" value="soft" defaultChecked={atHardCap} />
              <span>
                <span className="choice-card-title">{LIMIT_KIND_WORDS.soft.label}</span>
                <span className="tiny dim choice-card-note">{LIMIT_KIND_WORDS.soft.explain}</span>
              </span>
            </label>
          </fieldset>
          {atHardCap && (
            <p className="tiny dim limit-cap flush">{HARD_LIMIT_CAP_MESSAGE}</p>
          )}
          <fieldset className="segmented">
            <legend className="small muted">About what?</legend>
            <div className="segmented-options">
              <label>
                <input type="radio" name="ruleType" value="genre" defaultChecked />
                <span>A genre</span>
              </label>
              <label>
                <input type="radio" name="ruleType" value="runtime" />
                <span>A length</span>
              </label>
              <label>
                <input type="radio" name="ruleType" value="topic" />
                <span>A topic</span>
              </label>
            </div>
          </fieldset>
          <label className="small muted limit-genre">
            Genre
            <select name="genre" className="sel mt-1 full" defaultValue="">
              <option value="" disabled>
                Choose a genre
              </option>
              {MOVIE_GENRES.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
          <label className="small muted limit-topic">
            Topic
            <select name="topic" className="sel mt-1 full" defaultValue="">
              <option value="" disabled>
                Choose a topic
              </option>
              {CONTENT_TOPICS.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          {/* Shown for Never + A topic (app/globals.css): a film with no
              topic information fails closed (ruled 2026-11-12). */}
          <p className="tiny dim limit-topic-hint flush">Films with no topic information are also left out, to be safe.</p>
          <label className="small muted limit-minutes">
            Nothing over (minutes)
            <div className="search mt-1">
              <input type="number" name="minutes" min={MIN_RUNTIME_LIMIT} max={MAX_RUNTIME_LIMIT} step={1} />
            </div>
          </label>
          <button type="submit" className="btn">
            Add limit
          </button>
        </form>
      </section>

      {myLimits.length > 0 && (
        // The "weeks I'm not coming" setting is written to every one of the
        // person's rows (ruled 2026-11-12). A submit button with
        // role="switch": it works without script.
        <form action={setLimitsApplyWhenAbsent.bind(null, clubId, !appliesWhenAbsent)} className="card mt14 absent-switch-card">
          <button
            type="submit"
            role="switch"
            aria-checked={appliesWhenAbsent}
            className="consent-choice small switch-button absent-switch"
          >
            <span className="switch-track" aria-hidden="true" />
            Also on weeks I&apos;m not coming
          </button>
          <p className="tiny dim flush">Off: your limits only apply when you might be there.</p>
        </form>
      )}

      <p className="tiny dim mt14 when-changes-count">
        A change counts from the next time films are checked: the next nomination, or the close of a vote that&apos;s
        already open.
      </p>
    </MembersFrame>
  );
}
