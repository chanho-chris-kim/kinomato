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
- `docs/analysis-v1.md` — superseded, but still the source for the detailed flow
  rulings and the conflict table. v2 revises the revenue model and audience; it
  does not replace v1's product mechanics.
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

- **Rotation is computed, never stored.** `ORDER BY last_picked_at ASC NULLS FIRST`
  over active memberships, with postponements as an override. Storing a pointer
  turns every skip, join, leave and pause into a migration problem.
- **Lock is immovable.** After lock, RSVP changes do not re-run the constraint
  filter and the pick does not change. A lock people can't trust is worthless.
- **A cancelled night does not consume a turn.** A lost vote does — but all
  nominees belong to the picker, so they can only lose *which* of their films.
- **Never auto-advance as if confirmed.** No answer within the window logs the
  night as `unconfirmed`. History integrity is what makes the rotation trustworthy.
- **Constraints: hard vs soft.** Hard limits are never overridden and never voted
  on, capped at two per person. Soft preferences warn and break ties, never block.
  Constraints scope to members who RSVP'd yes.
- **Never surface constraint causality in the UI.** The eligible pool just is what
  it is. Never "horror unlocked because Dana is away."
- **No full attendance ranking, ever.** Top attendees or a personal streak only.
  A ranked list ending in last place is how you lose the member with a newborn.
- **Guest ratings stay club-local.** Only verified members' ratings enter public
  aggregates. This is the bot-resistance story and the data story.
- **Two pushes per week per member**, plus one extra on their picking week.
  Everything else is in-app. This is a product constraint, not a setting.

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
