# Kinomato

Repo: https://github.com/chanho-chris-kim/kinomato

A web app for friend groups who do a recurring movie night. Each member keeps a
watchlist, members take turns picking, the group votes, and the app keeps the
history. Later: public genre clubs that anyone can join.

Kinomato is a **ritual tool, not a decision tool.** Competitors help you pick
something tonight and get deleted. This keeps a group's weekly habit alive. When
a design choice is ambiguous, favour the thing that makes the club survive
another month over the thing that picks a film faster.

## Where the thinking lives

- `docs/analysis-v2.md` — the current analysis: flow, conflicts and their
  rulings, roles, revenue, market, risks. Read this before proposing product
  changes.
- `docs/analysis-v1.md` — superseded. v2 supersedes it wherever the two
  conflict. Retained only for the detailed flow narrative and the conflict
  table in §1.3, which v2 doesn't restate.
- `docs/watchlist-spec.md` — watchlist organisation, add/search flow, the lock
  screen, film metadata sourcing.
- `docs/prototype.html` — interactive prototype. Open it in a browser; the
  controls at the top switch screen size, theme, week stage and role. Faster than
  prose for answering layout and state questions.
  **Reference only — do not port this code.** Its state model is fake and it
  assumes a single synchronous client.

## Stack

- Next.js (App Router), TypeScript, Tailwind
- Postgres via Neon or Supabase, Drizzle for schema and migrations
- Deployed on Vercel; Vercel Cron drives the scheduled jobs
- Auth: v0 has none — invite token in a cookie plus name selection.
  Magic links via Resend come in v1. Do not add auth infrastructure early.
- Web Push (VAPID) with email fallback. No native app.

## Build order

1. Schema, plus `lib/rotation.ts` and `lib/constraints.ts` as pure functions
   **with tests**. These hold the only genuinely tricky logic in the product.
2. One rough page: whose turn, the nominees, voting. Deploy it and get real
   friends using it.
3. RSVP, night confirmation, turn advance.
4. Only then make it look like the prototype.

The purpose of v0 is to find out which rulings below are wrong.

## Rulings that are load-bearing

Do not quietly change these — they encode decisions that took a while to reach.

- **Rotation is computed, never stored.** Postponement is a membership
  property, not a night state — `postponed_at` on `memberships`. Order:
  `ORDER BY postponed_at IS NULL, postponed_at ASC, last_picked_at ASC NULLS FIRST`
  over active memberships. A cancelled night is independent of this — a
  night can be cancelled for reasons that have nothing to do with the picker.
  Storing a pointer turns every skip, join, leave and pause into a
  migration problem.
- **Lock is immovable.** After lock, RSVP changes do not re-run the constraint
  filter and the pick does not change. A lock people can't trust is worthless.
- **A cancelled night does not consume a turn.** A lost vote does — but all
  nominees belong to the picker, so they can only lose *which* of their films.
- **Never auto-advance as if confirmed.** No answer within the window logs the
  night as `unconfirmed`. History integrity is what makes the rotation
  trustworthy. Auto-advance is always on a bounded timer (24h / 48h / 7 days) —
  never offer "never" as an option. A club stalled forever on one picker is a
  dead club.
- **Constraints: hard vs soft.** Hard limits are never overridden and never voted
  on, capped at two per person. Soft preferences warn and break ties, never block.
  Constraints scope to members who RSVP'd yes.
- **Never surface constraint causality in the UI.** The eligible pool just is what
  it is. Never "horror unlocked because Dana is away."
- **Vetoes are discretionary, hard limits are automatic.** A veto removes one
  nominee from the slate and costs a token; it does not cancel the round. The
  picker is notified and may substitute another film if the nomination deadline
  hasn't passed, otherwise voting continues with what's left. If every nominee
  is vetoed, the picker keeps their turn and nominates again — consistent with
  "the picker never loses their turn, only which film." Vetoes are public, with
  the vetoer named — an anonymous veto reads as sabotage, a named one reads as
  a boundary. No vetoes after lock. A hard limit excludes automatically and
  costs nothing; a veto is a choice and costs a token.
- **No full attendance ranking, ever.** Top attendees or a personal streak only.
  A ranked list ending in last place is how you lose the member with a newborn.
- **History is shared and symmetric.** Every member sees the same club
  history — no admin-only view, no hidden data, consistent with there being
  no admin tier over data access. It contains every night (film, date, week
  number, picker, state including `cancelled` and `unconfirmed`), the final
  tally, both rating axes, hot takes, and who attended each individual night.
  It does **not** contain, and must not be reconstructible from what's
  stored: individual vote attribution after lock (live counts are visible
  during voting; once the night is over, keep "won 4-1" and drop who voted
  for what); the vetoer's name after the night ends (named live so a veto
  reads as a boundary, anonymised once it's history); watchlist edits (adding
  or removing a film is never a club-visible event); or any aggregate or
  percentage attendance figure per member (per-night attendance is fine —
  aggregating it rebuilds the ranked attendance list by another route).
  History is a record of what the club did together, not what each member did.
- **Guest ratings stay club-local.** Only verified members' ratings enter public
  aggregates. This is the bot-resistance story and the data story.
- **Two pushes per week per member, across all their clubs — not per club.**
  Plus one extra on their picking week. Notifications dedup across clubs someone
  belongs to. Everything else is in-app. This is a product constraint, not a
  setting.

## Things not to do

- Don't port the prototype HTML into React. Rebuild, check against it.
- Don't scrape IMDb for trivia. Derive facts from TMDB fields, or use Wikidata.
- Don't call the Letterboxd API. CSV import of a user's own export only.
- Don't put the TMDB key in a `NEXT_PUBLIC_` variable. Server-side only.
- Don't add third-party tracking pixels anywhere near a film page (VPPA exposure).
- Don't fetch streaming availability on browse. Nomination and lock only, 24h TTL.
  Film metadata caches indefinitely; availability does not.

## Naming

"Kinomato" is the product. Lowercase `kinomato` for the package name, repo,
database and env prefixes. "Movie night" stays lowercase and generic — it's the
activity the app is for, not a brand term. Club names are user-supplied; don't
hardcode one.

Note for any future trademark work: Kinomap (French fitness app, both stores) and
Kinoma (former Marvell division) are the nearest existing marks.

## Conventions

- Small commits, one branch per task, merge to `main` when tests pass.
- `main` stays deployable at all times — friends are using the preview URL.
- Pure logic in `lib/`, tested in isolation. UI components stay dumb.
- Club settings live in a single JSONB column, not eight nullable fields.
- TMDB attribution notice stays in the footer from the first commit.

## How I'd like you to work

- Scope a session to one shippable thing.
- Push back on my requests when they conflict with the rulings above or with
  something in `docs/`. I'm the only reviewer this project has — say so when you
  think I'm wrong, and explain why rather than just implementing it.
- Write the test before the implementation for anything in `lib/`.
- Tell me when something in `docs/` has gone stale so I can update it.

## Open questions

Things that aren't ruled on yet. Don't guess at these — ask, or flag them here
and move on.

- **"We watched something else" confirmation.** What film gets recorded? Does
  it enter history/ratings/the club-connections engine the same as a normal
  win, or does it need its own lighter-weight path since it never went through
  nomination or a vote?
- **Postponement duration.** Is there a cap on how long a membership can sit
  postponed, or a separate "paused" status for a multi-month absence (parental
  leave, deployment) distinct from missing one week?
- **Veto-exhaustion timing.** If every nominee gets vetoed close to the
  nomination deadline, does the picker get a deadline extension to
  re-nominate, or does the round proceed toward lock with nothing decided?
- **Veto token pool scope.** The settings table's "Veto tokens per season" —
  is that pool per member (like the two-hard-limit cap) or shared across the
  whole club?
- **How attribution actually gets scrubbed.** "Not reconstructible" (votes,
  vetoer) is stronger than hiding it in the UI — `votes.membership_id` and
  `vetoes.membership_id` are still sitting in the row otherwise. Does the
  post-night job null the column out, or does attribution live in a separate
  table that gets deleted/detached once the night closes?
