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
- `docs/onboarding-spec.md` — **the next build.** No guest tier, email
  code + link auth, per-person invites, global watchlists, the public/
  signed-in route split. Supersedes analysis-v2.md §5.1's three tiers
  and reverses analysis-v1.md §7.1's no-account invite loop. The
  identity, claim, invite-token and "no account settings page" rulings
  below still describe the running code and stay as written until that
  code lands — the spec's §8.4 lists exactly which ones get rewritten
  then.
- `docs/prototype.html` — interactive prototype. Open it in a browser; the
  controls at the top switch screen size, theme, week stage, who's viewing
  (signed in, brand new, or signed out) and how they arrived. Faster than
  prose for answering layout and state questions.
  **Reference only — do not port this code.** Its state model is fake and it
  assumes a single synchronous client.

## Stack

- Next.js (App Router), TypeScript, Tailwind
- Postgres via **Neon**, specifically. The deployed app's driver
  (`@neondatabase/serverless` + `drizzle-orm/neon-http`) speaks Neon's HTTP
  protocol, not the generic Postgres wire protocol — Supabase is no longer
  a drop-in swap for the deployed app the way "Neon or Supabase" used to
  imply. Local dev (`drizzle-kit`, `db/seed.ts`) still uses the plain node
  `postgres` driver and can point at any Postgres, Neon or otherwise.
- **Two DB drivers, deliberately — not a bug to unify later:**
  - `db/index.ts` (`getDb()`) — `drizzle-orm/neon-http`, runs inside the
    Cloudflare Worker. Request-scoped via React's `cache()`, never a
    module-scope singleton: Workers doesn't allow reusing a connection
    across requests, and a top-level client would work in local testing
    and fail under real concurrent traffic. No `db.transaction()` —
    neon-http throws "No transactions support" at runtime — use
    `db.batch([...])` instead, which is atomic over one HTTP call, for
    statements that don't need to read each other's results.
  - `db/seed.ts` and `drizzle.config.ts` — plain `postgres` (node driver).
    They run locally in Node, never in the Worker, and have no reason to
    pay the HTTP-driver's restrictions.
- Deployed on **Cloudflare Workers** via `@opennextjs/cloudflare`, not
  Vercel — a deliberate choice: cost at scale, and the domain is already
  on Cloudflare. The cost is adapter-layer risk on every Next.js release,
  since OpenNext has to catch up to each one. `next.config.ts` runs
  `initOpenNextCloudflareForDev()` so local dev behaves like the Worker.
  Cloudflare Cron Triggers (`wrangler.jsonc`) replace Vercel Cron for
  scheduled jobs, once there are any.
- **`next/image` works on this deployment without an `env.IMAGES`
  binding — verified, not assumed.** Confirmed by building with
  `opennextjs-cloudflare build`, running the real bundle under `wrangler
  dev`, and fetching a real TMDB poster through `/_next/image?url=...`:
  `200`, correct `image/jpeg`, exactly the requested pixel dimensions.
  OpenNext's `/_next/image` handler (`@opennextjs/cloudflare`'s
  `handleImageRequest`) degrades gracefully when `env.IMAGES` is
  undefined — it still validates the URL against `images.remotePatterns`
  (so that config in `next.config.ts` is load-bearing, not optional) and
  serves the original image unchanged, just without Cloudflare's own
  resize/format-conversion step. That's a non-issue here specifically:
  TMDB already serves pre-sized assets by path (`/t/p/w92/...`,
  `/t/p/w185/...`), so the "optimization" Cloudflare's binding would add
  on top is marginal. No `images.unoptimized` or custom loader needed.
  Revisit only if a future image source doesn't pre-size (Cloudflare
  Images is a separate product/cost to opt into, not a Workers default).
- **Two deployments, on purpose, until launch:**
  - `kinomato.com` + `www` — a static holding page (Cloudflare project
    `kinomato-landing`, hand-uploaded, not in this repo). Deliberately
    decoupled so an app build can never take down the public domain.
  - `dev.kinomato.com` — this app's Worker. Branch previews stay on
    `*-kinomato.chris92529.workers.dev`.
  At launch this collapses to one: build the real marketing page as the
  app's root route, move the current dev club list to `/clubs`, then move
  the `kinomato.com` custom domain from the landing project to the Worker
  and delete the landing project. The holding page is scaffolding — it
  does not get promoted.
- Auth: magic links via Brevo (`lib/email.ts`, `BREVO_API_KEY`,
  falls back to a console-logged link when unset — same shape as
  `TMDB_READ_TOKEN`). No passwords, no social login, no account
  settings page. See the identity/claim/invite-token rulings below —
  this is v1, not v0 anymore.
- Web Push (VAPID) with email fallback. No native app.

## Build order

1. Schema, plus `lib/rotation.ts` and `lib/constraints.ts` as pure functions
   **with tests**. These hold the only genuinely tricky logic in the product.
2. One rough page: whose turn, the nominees, voting. Deploy it and get real
   friends using it.
3. RSVP, night confirmation, turn advance.
4. Only then make it look like the prototype.

Built beyond this list as the need became concrete rather than as a
separate planned step: lock (`/clubs/[clubId]`'s "Lock it in"), club
creation and invites (`/new`, `/clubs/[clubId]/join`), and first-night
(`lib/schedule.ts` plus the lazy draft-night creation on `/clubs/[clubId]`
page load — see the ruling below). A club created today reaches its
first nomination with zero hand-seeding: `e2e/first-night.spec.ts` is
the proof, running the whole loop — create, invite, join, watchlist,
nominate, vote, lock, confirm, rate — on data the test itself creates.
v0 is feature-complete; what's left is the Open Questions below.

The purpose of v0 is to find out which rulings below are wrong.

## Rulings that are load-bearing

Do not quietly change these — they encode decisions that took a while to reach.

- **Rotation is computed, never stored.** Postponement is a membership
  property, not a night state — `postponed_at` on `memberships`. Order:
  `ORDER BY postponed_at IS NULL, postponed_at ASC, last_picked_at ASC NULLS FIRST, joined_at ASC, id ASC`
  over active memberships. The trailing `id ASC` isn't decoration — without
  it, a tie is nondeterministic. A cancelled night is independent of this —
  a night can be cancelled for reasons that have nothing to do with the
  picker. Leaving and rejoining doesn't reset `last_picked_at` or let
  anyone jump the queue: every membership carries a stable `identity_key`
  (the user's id where there is one, otherwise a per-club token minted on
  first join and stored in a guest's invite cookie), and a rejoined
  membership inherits the most recent pick from any prior membership with
  the same `identity_key` in that club. A guest who clears cookies gets a
  new `identity_key` and can't be matched — accepted, not solved. Storing
  a pointer turns every skip, join, leave and pause into a migration
  problem.
- **Lock is immovable.** After lock, RSVP changes do not re-run the constraint
  filter and the pick does not change. A lock people can't trust is worthless.
  Locking itself (analysis-v1.md §1.1 stage 8) tallies the night's votes and
  writes the winner to `winning_film_id` — two entry points, one shared core
  (`lockNightCore`): a manual "Close voting and set the pick" button, and a
  not-yet-built scheduled job (SEAM comment in `lockNightCore.ts` — needs a
  `lockTime` key added to `clubs.settings` and a Cloudflare Cron Trigger).
  **The button is restricted to owner/admin**, not any club member — this
  overrides an earlier ruling here that any member could lock. Reasoning for
  the change: the button only exists because the cron doesn't yet — it's
  scaffolding for a mechanism that's supposed to be automatic and time-
  based, not a discretionary member action. A member accidentally ending
  the vote early (fixing the pick before people meant to finish voting) is
  a worse failure than making people wait for an owner or admin to do it.
  Once the scheduled job ships, this button's role question mostly stops
  mattering — the clock will beat manual clicks to it in the common case.
  Tie-break chain: most votes, then fewest soft-
  preference conflicts among attending members
  (`countSoftPreferenceConflicts`), then nomination id ASC as a last-resort
  deterministic fallback — `analysis-v2.md` §2's further "club overlap
  descending" tiebreak key isn't wired in, since it needs a query this
  function doesn't otherwise do (see Open Questions). Once locked: a vote is
  a silent no-op, not a thrown error (the vote button only renders on an open
  night, so the only way to reach this path is a stale tab or direct
  tampering — the same "lost the race" shape as confirmNight and lockNight
  losing a race to each other). A veto throws instead of no-opping: there's
  no veto UI yet for a stale tab to leave open (see Open Questions), so
  reaching this path at all means a caller — test or future UI — deserves an
  explicit signal, not a silent swallow. An RSVP change still succeeds — per
  the ruling above, it just doesn't touch `winning_film_id`.
- **A club has at most one night in flight.** `draft`, `open`, and `locked`
  are non-terminal; `watched`, `cancelled`, and `unconfirmed` are terminal.
  Enforced by a partial unique index — `nights_one_in_flight_per_club` on
  `nights(club_id) WHERE state IN ('draft', 'open', 'locked')` — so a second
  in-flight night is a rejected insert, not a UI ambiguity. A page that needs
  "the" open or draft night for a club can look it up with a plain `find`
  and never has to decide between two candidates, because the database
  guarantees there's only ever one.
- **A night's first `draft` row is created lazily, on `/clubs/[clubId]`
  page load** — not a cron, not a button. If the club has no
  non-terminal night and `getNextPicker` resolves someone, that request
  inserts a `draft` night for them with `scheduledAt` from
  `lib/schedule.ts`'s `getNextOccurrence`, computed once and never
  recomputed for "Whose turn" on that same render (recomputing after the
  insert would flip it to a different, more confusing answer than the
  nomination section right below it — see the comment in
  `app/clubs/[clubId]/page.tsx`). The "one night in flight" index turns
  a race between two simultaneous page loads into a rejected insert on
  the loser, caught and re-read rather than thrown — same shape as
  confirmNight and lockNight losing a race to each other. `ad_hoc`
  clubs can't lazy-create (no standing day/time to compute from) and get
  their own explicit "no night scheduled" state, not a broken-looking
  blank one — and there's no UI yet to schedule one for them manually.
- **`lib/schedule.ts`'s "monthly" means the Nth occurrence of a weekday,
  not a calendar day.** `clubs` only stores `default_day` (a weekday),
  not a day-of-month, so "the 2nd Saturday of the month" is the only
  reading "monthly" + a weekday picker can support — chosen because it's
  what most recurring-meetup products mean by that combination, not
  because it's the only defensible choice. When the Nth occurrence
  doesn't exist in a later month (a "5th Friday" club hits a 4-Friday
  month), it clamps to that month's last occurrence rather than skipping
  the month — skipping would make the club's own page look broken one
  month most years. DST correctness (get 8pm local right on both sides
  of a transition) is the part of this module that's actually tested
  hard; the monthly interpretation is a reasoned judgment call worth
  revisiting if it doesn't match what a club expects.
- **A cancelled night does not consume a turn.** A lost vote does — but all
  nominees belong to the picker, so they can only lose *which* of their films.
- **Never auto-advance as if confirmed.** No answer within the window logs the
  night as `unconfirmed`. History integrity is what makes the rotation
  trustworthy. Auto-advance is always on a bounded timer (24h / 48h / 7 days) —
  never offer "never" as an option. A club stalled forever on one picker is a
  dead club.
- **Constraints: hard vs soft.** Hard limits are never overridden and never voted
  on, capped at two per person. Soft preferences warn and break ties, never block.
  Scoping is asymmetric: a hard limit applies to everyone who has **not
  explicitly RSVP'd no** — no answer counts as attending, because silently
  dropping an unanswered person's hard limit is how they end up watching the
  one thing they can't. A soft preference applies only to explicit
  yes-RSVPs. `applies_when_absent` overrides both.
- **Genre and keyword constraints match on TMDB ids, never display strings.**
  `constraints.value` holds the id; `constraints.label` is a UI-only copy,
  never read by matching logic. "Sci-Fi" vs "Science Fiction" must never
  silently fail a hard limit — a hard limit that silently fails is the worst
  failure mode in the product. Language constraints stay on ISO 639-1 codes.
- **Missing-data policy has two axes.** Unknown data **about a film** fails
  closed where the gap could cause harm, fails open where it's only
  inconvenient. The test: *would getting this wrong hurt someone, or just
  annoy them?* A null `certification` fails closed (age ceiling). Empty
  `genre_ids`/`keyword_ids` fail closed — a body-horror limit protects
  someone from distress, so if we can't confirm a film isn't the excluded
  thing, we don't serve it. A null `runtime` or `original_language` fails
  open — a subtitle limit only protects someone from mild tedium, same as
  runtime being logistics, not safety. Soft preferences never fail closed
  on missing data, or on anything else.
  Unknown **system configuration** fails **loud**, never closed and never
  silent. An unrecognized age-rating ceiling, or a film certification in a
  rating scheme nothing maps, throws a descriptive error rather than
  silently emptying the eligible pool — that's our bug, not a fact about
  the film. Validate configuration values (e.g. a ceiling) at settings-write
  time so this can't be stored in the first place; the throw is defense in
  depth, not the primary guard.
- **Never surface constraint causality in the UI.** The eligible pool just is what
  it is. Never "horror unlocked because Dana is away."
- **Vetoes are discretionary, hard limits are automatic.** A veto removes one
  nominee from the slate and costs a token from that member's own pool (per
  member per season, same shape as the two-hard-limit cap — never shared
  club-wide). It does not cancel the round. The picker is notified and may
  substitute another film if the nomination deadline hasn't passed, otherwise
  voting continues with what's left. If every nominee is vetoed, the picker
  keeps their turn and nominates again — consistent with "the picker never
  loses their turn, only which film." Vetoes are public, with the vetoer
  named — an anonymous veto reads as sabotage, a named one reads as a
  boundary. No vetoes after lock. A hard limit excludes automatically and
  costs nothing; a veto is a choice and costs a token.
- **No full attendance ranking, ever.** Top attendees or a personal streak only.
  A ranked list ending in last place is how you lose the member with a newborn.
- **History is shared and symmetric.** Every member sees the same club
  history — no admin-only view, no hidden data, consistent with there being
  no admin tier over data access. It contains every night (film, date, week
  number, picker, state including `cancelled` and `unconfirmed`), the final
  tally, both rating axes, hot takes, and who attended each individual night.
  It does **not** surface: individual vote attribution after lock (live
  counts are visible during voting; once the night is over, keep "won 4-1"
  and drop who voted for what); the vetoer's name after the night ends (named
  live so a veto reads as a boundary, anonymised once it's history); watchlist
  edits (adding or removing a film is never a club-visible event); or any
  aggregate or percentage attendance figure per member (per-night attendance
  is fine — aggregating it rebuilds the ranked attendance list by another
  route). History is a record of what the club did together, not what each
  member did.
- **Attribution is retained, never deleted — access is the control.**
  `votes.membership_id` and `vetoes.membership_id` persist permanently; they
  are the audit trail and deletion would make debugging impossible. What
  enforces the ruling above is a single history-read module that is
  physically incapable of returning attribution — not a per-component
  reminder to omit it. General history and the vetoer's identity after a
  night closes go through that module and never see `membership_id`. The one
  exception is a member reading their own vote back, which is a distinct
  query path, not the shared history path. Every other read of votes or
  vetoes goes through the same module — no direct queries against those
  tables elsewhere in the codebase.
- **Guest ratings stay club-local.** Only verified members' ratings enter public
  aggregates. This is the bot-resistance story and the data story.
- **Blind reveal: a member's whole rating — both scores and any hot take —
  stays hidden from everyone else until every attending member has rated.**
  Hiding only the text and not the quality/fun scores wouldn't stop
  anchoring, since a visible 9/10 biases the next rater as much as a
  written take does. "Attending" means an explicit yes-RSVP, matching the
  constraint scoping asymmetry — someone who never answered didn't
  necessarily watch. This is a different mechanic from analysis-v1.md's
  "spoilers for absent members" (blurred until *you* mark yourself as
  having watched it) — that one protects someone who missed the night,
  this one protects the group's honesty while everyone's still rating.
  Both can be true at once; only this one is built in v0.
- **Two pushes per week per member, across all their clubs — not per club.**
  Plus one extra on their picking week. Notifications dedup across clubs someone
  belongs to. Everything else is in-app. This is a product constraint, not a
  setting.
- **Free tier caps a club at six members**, enforced server-side at the
  moment someone actually joins (`lib/clubMembers.ts`'s `canAddMember`,
  called from `/clubs/[clubId]/join`'s `joinAsNewMember`), not just at
  creation — an invite can circulate well past who the owner first added.
  A refused join redirects back to the join page with the limit named in
  a visible message, never a silent no-op: unlike the lock-immovability
  no-ops (a benign lost race), a refused signup is new information a
  person needs to see and act on. Checked with a plain count query, not a
  DB constraint — a soft business-tier cap, not a safety invariant like
  "one night in flight," so a race under truly simultaneous joins
  (someone slipping in as a seventh member) is an accepted gap. A hard
  constraint here would also be the wrong shape long-term: the cap is
  meant to change per plan once paid tiers exist, which a fixed DB check
  can't express as easily as an application-level read.
- **A name is first name + last initial, always — never a single free-
  text field.** `display_name` stays the one stored column, composed
  from the two (`lib/memberName.ts`'s `composeDisplayName`, e.g. "Chris
  K."), not stored separately — same "not eight nullable fields"
  reasoning as `clubs.settings`. This is mandatory, not a form
  preference, specifically because `/clubs/[clubId]/join` lets someone
  claim a name the owner pre-added: if the owner wrote "Priya S." and
  Priya typed just "Priya," she'd create a second membership instead of
  claiming her own. `/new` (both the creator's own name and pre-added
  members) and `/join`'s add-yourself path all call the same
  `validateMemberName` — first name non-empty, last initial exactly one
  letter, both trimmed, the initial uppercased so "k" and "K" can't
  become two different people. That last point is load-bearing, not
  cosmetic: it's specifically what makes "the same person always
  composes to the same string" true, which is what makes claiming an
  existing name actually work. No email, no full last name — this is
  the full extent of "who are you" in v0.
- **A club with no nights renders a distinct first-run state, not a
  generic empty one.** `/clubs/[clubId]` distinguishes "this club has
  never had a night" (`clubNights.length === 0`) from "nothing's in
  flight right now, but history exists" (the older, more generic "No
  open vote right now"). The first-run state doesn't say "coming soon" —
  nothing creates a night's first `draft` row yet (see Open Questions),
  so for every club created today this is permanent, not transitional —
  and points at the one thing actually actionable right now: the invite
  link, surfaced directly on the page next to a plain-text member list.
- **The confirmation prompt respects `clubs.settings.confirmAt`, not a
  fixed "past scheduled_at" rule.** `lib/confirmTiming.ts`'s
  `confirmableAt`/`isConfirmable` implement 3 of analysis-v2.md §2's 5
  documented options — `morning_after` (default, 9am local the day after
  `scheduled_at`, reusing `lib/schedule.ts`'s timezone-correct date math
  rather than raw-hours arithmetic), `same_night` (the old fixed
  behavior, now one option among several), and `manual_only` (no time
  gate at all — confirmable even before the night happens). `"2 days"`
  and `"off"` aren't implemented; `getConfirmAt` (`lib/clubSettings.ts`)
  falls back to the default for either, same as any unrecognized value —
  see Open Questions. The three implemented options read as an
  increasingly permissive gate (same_night → morning_after →
  manual_only); that ordering is a judgment call, not something
  analysis-v2.md specifies, and is worth revisiting if it doesn't match
  what a club expects.
- **`RatingSlider` (`app/clubs/[clubId]/RatingSlider.tsx`) is the second
  justified client component**, after `NominationSelector` — same
  reasoning: a plain form can't keep a range input and a number input
  showing the same live value in sync, so it needs local `useState`. The
  server action (`submitRating`) re-validates the 0–10 range
  independently; the client component's only job is display and the two
  inputs agreeing with each other.
- **Tags on a rating are club-scoped, alongside the hot take, never
  replacing it.** `tags` (club_id, name, display_name) and `rating_tags`
  (rating_id, tag_id) — "cozy" is one tag per club, not six near-
  duplicates across members, consistent with "reuse over invention."
  `lib/tags.ts`'s `normalizeTag` (trim, lowercase, collapse inner
  whitespace) is the single matching key; `displayName` keeps the
  first-seen casing, never overwritten by a later member's casing on the
  same tag (`addRatingTag` in `app/clubs/[clubId]/actions.ts`).
  Deliberately **no rename-in-place**: a club-scoped tag is a reference
  to a shared row, so "editing" a tag on your rating is remove-then-add,
  not relabeling the row (which would silently rename it for every other
  rating that shares it) — "edit and remove your own tags" is served by
  remove + re-add, not a third action. Tags follow the same blind-reveal
  rule as scores and hot takes: they only show on `revealedRatings`, and
  a club-scoped tag page (`/clubs/[clubId]/tags/[tag]`, keyed on the
  normalized name) only lists a film once its night's ratings are fully
  revealed. **No cross-club or global tag aggregation** — that's the
  public data story from analysis-v2.md §1.5 and it has privacy
  constraints not designed for yet; every tag query is scoped to one
  `club_id`. One accepted, narrow leak: the add-tag autocomplete
  (`ratingSection.clubTagOptions`) draws from every tag ever used in the
  club regardless of reveal state, so a brand-new tag from someone's
  not-yet-revealed rating can theoretically appear in another member's
  autocomplete before the reveal — a weak signal that "someone already
  rated," not the rating itself. Judged not worth gating a plain
  `<datalist>` on reveal state for; revisit if it turns out to bother
  people in practice.

- **Theming is one attribute, not a rewrite.** `docs/prototype.html`'s
  "late show" palette is ported into `app/globals.css` as
  `:root[data-theme="late"]` custom properties, set once via
  `data-theme="late"` on `<html>` (`app/layout.tsx`) — every page
  inherits `--bg`/`--fg`/`--accent`/etc. through normal CSS cascade, no
  React context needed. "Rep house" and "video rental" are future
  `[data-theme="..."]` blocks alongside this one, not a rewrite — and
  there's no theme picker UI yet (deliberately not built this pass, see
  Open Questions). The prototype's shared component classes (`.card`,
  `.btn`, `.chip`, `.pill`, `.avatar`, `.poster`, `.nominee`, `.search`,
  `.result`, `.slider`, `.grid3`, etc.) are ported the same way — used
  directly in JSX className props, not reimplemented as Tailwind
  utilities, so the palette and spacing rhythm stay exactly what the
  prototype specifies rather than a hand-translated approximation.
  `AppShell` (`app/clubs/[clubId]/AppShell.tsx`) is the responsive shell
  (bottom tab bar on phones → icon sidebar at 620px → labeled sidebar at
  900px → optional context rail at 1120px, all via `.app`'s
  `container-type: inline-size` and `@container` queries, not viewport
  media queries) used by the club page, watchlist, and tag page — /new
  and /join stay standalone themed cards with no nav shell, matching
  their pre-styling behavior of not rendering one. `.main` establishes
  its *own* nested container context specifically so `.grid3`'s column
  count responds to `.main`'s actual rendered width, not `.app`'s full
  width — without that, a page with no rail (full-bleed `.main` at
  1120px+) would cram 5 poster columns into whatever width happened to
  be available instead of the width that's actually there.
  **The context rail only ever shows real data, repurposed — never the
  prototype's fake turn-order queue, streaming-expiry list, or
  attendance leaderboard.** The club page's rail mirrors the Members
  list (also still in `.main`, unabbreviated, so nothing about who's in
  the club or the invite link ever depends on a 1120px+ viewport to be
  reachable — most of this club's members are on phones). Pages with no
  genuine secondary content (watchlist, tags) pass no `rail` prop at
  all, rather than rendering an empty or fabricated one; `.main:only-child`
  in the 1120px query keeps a railless page's content column capped at
  the same width the 900px breakpoint set, instead of stretching
  full-bleed with nothing to balance it against.
- **The "locked" night display (starts/runs/out-by) is a new section,
  not a restyle of an existing one.** Before this, the gap between a
  night locking and the confirmAt threshold clearing rendered nothing at
  all — CLAUDE.md's confirmAt ruling only covers when the "Did you watch
  X?" prompt appears, not what shows before that. This section
  (`app/clubs/[clubId]/page.tsx`) is pure display over data already on
  hand (`films.runtime`, `nights.scheduledAt`, `nights.winningFilmId`) —
  no new query shape, no new write, no new user action, and it only ever
  renders in place of the confirm prompt, never alongside it (the
  "one night in flight" invariant guarantees there's only ever one
  candidate night for either section).
- **Identity resolves in a fixed fallback order: per-club cookie, then
  session, then nothing.** `getIdentityMembershipId`
  (`app/clubs/[clubId]/identity.ts`) checks
  `kinomato_identity_{clubId}` first — cheap, no DB read, and what
  every guest always has, unchanged since v0. Only if that's missing
  does it fall back to the site-wide `kinomato_session` cookie
  (`app/session.ts`): session → `users.id` → look up the membership row
  for `(clubId, userId)`. A guest with no session has no fallback and
  is genuinely signed out, same as always. **Clearing cookies is
  survivable for a verified member not because any cookie is
  unclearable — clearing cookies clears the session cookie too — but
  because `users.email` is a durable anchor.** Requesting a fresh magic
  link re-finds the same `users` row by email every time, and every
  membership whose `identity_key` is that `users.id` recognizes the
  resulting new session immediately. This is also what makes a new
  device work: it never had any cookie, guest or session, and doesn't
  need one — verifying an email there is the entire recovery
  mechanism. No signing library, no unclearable storage; a `sessions`
  table (`app/session.ts`, `createSession`/`getSessionUserId`) plays
  the role a cookie-signing dependency usually would, read straight
  from Postgres like everything else in this app.
- **Claiming updates the existing membership row in place — it never
  creates a new one.** `app/verify/route.ts`'s claim branch sets
  `userId` and `identity_key` (both to the new `users.id`) on the exact
  membership row `magic_links.claim_membership_id` points at, gated on
  that row still being unclaimed (`userId IS NULL`) so a narrow
  double-click race can't steal a membership out from under a first
  claim. This is what CLAUDE.md's rotation ruling already depends on:
  `identity_key` is "the user's id where there is one, otherwise a
  per-club token," and rotation carry-forward on rejoin matches
  memberships by `identity_key` — a claim that inserted a fresh
  membership instead would orphan the guest row's `last_picked_at` and
  hand the claimer a clean rotation slate, silently jumping the queue.
  Updating in place means the exact same row — same `last_picked_at`,
  same `joined_at`, same rotation position — just gained a `userId`.
  The prompt itself (`ClaimPrompt`, `app/clubs/[clubId]/ClaimPrompt.tsx`)
  only ever fires at a moment of real loss aversion, never on arrival:
  a guest's watchlist reaching 3+ films (a rating is one row and costs
  little to lose; a built watchlist is slower to rebuild, so that's the
  threshold, not a rating existing), or an unclaimed guest *owner* on
  the club page regardless of watchlist size — a guest-owned club whose
  only owner clears cookies permanently loses its invite-token
  rotation and settings control, a real failure mode rather than a
  preference. Never a wall either way: ignoring the prompt changes
  nothing about what a guest can already do.
- **Invite links carry a token; a club id alone no longer admits a
  joiner.** `clubs.invite_token` (minted with the same
  `crypto.randomUUID()` convention every other generated id in this app
  uses) is required as `?token=` on `/clubs/[clubId]/join` — missing or
  mismatched shows a clear "invalid or rotated" state, not a generic
  404. A Server Action is callable directly, not just through whatever
  page rendered its bound form, so `claimExistingName` and
  `joinAsNewMember` (`app/clubs/[clubId]/join/actions.ts`) both
  re-check the token server-side via `requireValidInviteToken` — the
  join *page* gating its own UI on a valid token isn't a security
  boundary by itself. Validation-error redirects
  (`joinErrorUrl`) preserve the token in the query string; dropping it
  would land a refused joiner back on the "invalid invite link" state
  instead of the actual message (a taken name, the free-tier cap) they
  need to see and act on. **Rotating is owner/admin only** — same
  restriction shape as `lockNight`, both being "this changes something
  every member depends on" actions — and just overwrites the column;
  any link holding the old value fails immediately on its next use,
  nothing to expire or garbage-collect.

## Things not to do

- Don't port the prototype HTML into React. Rebuild, check against it.
- Don't scrape IMDb for trivia. Derive facts from TMDB fields, or use Wikidata.
- Don't call the Letterboxd API. CSV import of a user's own export only.
- Don't put the TMDB key in a `NEXT_PUBLIC_` variable. Server-side only.
- Don't add third-party tracking pixels anywhere near a film page (VPPA exposure).
- Don't fetch streaming availability on browse. Nomination and lock only, 24h TTL.
  Film metadata caches indefinitely; availability does not.
- Don't put the Brevo key in a `NEXT_PUBLIC_` variable. Server-side only,
  same as the TMDB token.
- Don't build a login-required wall anywhere, an account settings page,
  password reset, or social login. Auth is magic links and nothing else;
  a guest can fully participate forever without ever seeing a prompt
  that blocks anything.

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
- **User-facing validation errors from a plain `<form action>` redirect
  back to the same page with the message in an `?error=` query param**
  (`app/new/actions.ts`, `app/clubs/[clubId]/join/actions.ts`), rather
  than throwing. A thrown error in a server action has no error boundary
  to land in anywhere in this app, so the only default is a dev-mode
  overlay or a generic production digest — worse than the "clear
  message" these screens need. Reserve this for validation the user is
  meant to see and correct (a taken name, a cap hit); a genuine bug
  (a failed DB write) should still throw.
- Club settings live in a single JSONB column, not eight nullable fields.
- TMDB attribution notice stays in the footer from the first commit.
- CI (`.github/workflows/ci.yml`) runs typecheck, lint, and test on every
  push and on PRs to `main` — no database needed, `lib/` tests are pure.
  `npm run check` runs the same three locally; the pre-push hook runs it
  too, so a failure is caught before it reaches CI, not after.
- **E2E: Playwright, not Cypress** — multiple simultaneous members in one
  test needs separate browser contexts, which Playwright handles cleanly.
  (Superseded ruling: this file used to say no E2E until the voting flow
  stabilised. Overridden — the QA net starts now, while there's only one
  flow to cover, not after there are five.)
  - `e2e/` — one spec file, six scenarios matching a manual click-through:
    identity persists across reload, a vote increments its nominee's
    count, changing a vote moves it rather than duplicating (the
    `db.batch()` path — this is the one most worth having a test for,
    since neon-http silently having no `db.transaction()` is exactly the
    kind of thing that fails quietly), two members in separate browser
    contexts both voting correctly, RSVP persists across reload, and the
    displayed picker is checked against `lib/rotation.ts`'s own
    `getNextPicker()` output for the same seeded data — not a hardcoded
    expectation, so it can't drift out of sync with the rotation logic.
  - Runs against a **local** server, never `dev.kinomato.com`: `next dev`
    on a developer's machine, `next build && next start` in CI
    (`playwright.config.ts` switches on `CI`). CI tests a production
    build because some bugs only show there — the invite-rotation test
    raced its own server action, hidden by `next dev`'s slower responses
    and exposed every time by a production build. Still not the Workers
    runtime itself; the Workers Builds check covers the bundle building,
    not its runtime behaviour. Either way, a
    dedicated `E2E_DATABASE_URL` Neon branch, wiped and reseeded fresh
    (`e2e/global-setup.ts`, reusing `db/seed.ts`) at the start of every
    run. Tests run serially (`workers: 1`) on purpose — they share and
    build on that one branch's mutable state within a run, so parallel
    execution would race.
  - CI runs E2E as its own job (`e2e`, in `ci.yml`), separate from
    `check`, specifically so a flaky or slow E2E run never blocks a pure
    logic fix. Don't add `E2E` to `main`'s required status checks in
    GitHub branch protection — only `Check`. Trace-on-failure
    (`retain-on-failure`) uploads as a build artifact when a run fails.

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

- **Trusted tier is schema room only.** `users.trusted_at`
  (analysis-v2.md §5.1) exists — non-null would mean trusted, same
  "nullable timestamp as a flag" shape as `paused_at`/`left_at` — but
  nothing sets it and nothing reads it. Trust signals (§5.2: invite
  provenance, account age/cadence, rating variance, cross-club
  presence, device/network clustering) and the weighted-public-ratings
  behavior that would consume this tier are entirely undesigned.
- **Multi-club membership has no UI.** A single `users` row can now
  back memberships in several clubs (nothing stops it), but there's no
  "my clubs" list anywhere to browse them — landing on a bare `/login`
  or `/verify` with no `returnTo` goes to `/` (the dev club-listing
  page, itself scaffolding per this file's Stack section), not
  anywhere club-specific. A person recovering their identity on a new
  device has to already have a specific club's URL in hand.
- **Claim-race edge case is accepted, not handled.** If a membership
  somehow gets claimed by someone else between a claim prompt being
  shown and that link being clicked (two people racing the same
  guest slot — narrow, not the common path), `/verify` silently skips
  the membership update and just logs the clicker in as themselves,
  rather than surfacing an error. Same posture as the free-tier cap's
  accepted join race — a narrow gap, not a safety invariant.
- **No theme picker, and only "late show" is built.** `docs/prototype.html`
  documents "rep house" and "video rental" as two more full palettes —
  the CSS structure (`[data-theme="..."]` blocks in `app/globals.css`)
  is ready for them, but nobody has ported their tokens, and there's no
  UI anywhere (club settings or otherwise) to choose a theme per club.
  Every club renders "late show" today, hardcoded via `<html
  data-theme="late">` in `app/layout.tsx`.
- **The new "locked" night section has no E2E coverage.** Every seeded
  club currently either reaches confirmability before the page ever
  renders the locked state, or (club 6) is confirmable immediately
  (`manual_only`), so nothing in `e2e/` exercises the starts/runs/out-by
  display. Verified manually against a temporarily-nudged night during
  this session, not by an automated test — a club seeded specifically
  into the locked-but-not-yet-confirmable gap would close this.
- **"We watched something else" confirmation.** What film gets recorded? Does
  it enter history/ratings/the club-connections engine the same as a normal
  win, or does it need its own lighter-weight path since it never went through
  nomination or a vote?
- **`confirmAt`'s "2 days" and "off" options aren't implemented.**
  analysis-v2.md §2 documents 5 options; `lib/confirmTiming.ts` and
  `lib/clubSettings.ts`'s `getConfirmAt` only know `morning_after`,
  `same_night`, and `manual_only` — either unimplemented value silently
  falls back to the `morning_after` default, same as any unrecognized
  string. Needs a ruling on what "2 days" delays from (scheduled_at, same
  as morning_after) and what "off" means operationally (never
  confirmable through this prompt at all — does the night just sit
  non-terminal forever, or does something else eventually close it?).
- **Vetoes have no UI, no pool-cap enforcement, and no season lifecycle.**
  `castVeto` (`app/clubs/[clubId]/actions.ts`) is a minimal seam — it inserts
  a veto row and rejects one after lock, nothing more. It doesn't enforce the
  two-per-member-per-season cap from the veto ruling above, doesn't let the
  picker substitute a replacement nominee, and doesn't remove a vetoed film
  from the nominee list the UI renders. Seasons aren't a built feature either
  — nothing creates one on any real trigger; `getOrCreateCurrentSeasonId`
  (`app/clubs/[clubId]/season.ts`) exists only so a veto has somewhere to
  attach, not as season start/end policy. Consequently, "vetoes are rejected
  after lock" is implemented but unverified by any test — there's no veto
  button for an E2E test to click, and a "use server" action can't be unit-
  tested the way pure `lib/` code can (it needs `cookies()`, which needs a
  request context vitest doesn't have).
- **Lock's tie-break stops one key short of analysis-v2.md §2.** After votes
  and soft-preference conflicts, the documented next key is club-overlap-
  descending, then film id. `lib/lockTally.ts` skips straight to a
  nomination-id fallback — club overlap needs a per-film watchlist-overlap
  count across every member, a separate query `lockNightCore` doesn't
  otherwise make, not a filter over data already in hand the way the soft-
  preference signal is.
- **`clubs.settings.lockTime` doesn't exist.** Referenced in the lock
  ruling's scheduled-job seam as what a cron would eventually read (paired
  with analysis-v1.md §1.1 stage 8's "24 hours before the night" default) —
  nobody has added the key, a reader for it (the `lib/clubSettings.ts`
  shape), or any UI to set it.
- **Member-level rating preferences.** The age-rating ceiling is a club-level
  filter (`films.certification`). Whether an individual member can also set
  their own rating preference, and if so whether it's hard or soft, isn't
  ruled on.
- **Multi-country certification.** `films.certification` is one global value,
  but TMDB certification is genuinely per-country. Deliberately deferred —
  analysis-v2.md §9 keeps family mode out of v1 entirely, so nothing depends
  on this yet, and the age-ceiling setting isn't exposed in any UI. When it
  is built: a `film_certifications(film_id, country, certification)` table,
  not a JSONB map — decided in advance so this doesn't need a fresh ruling
  later, even though building it is still open.
- **Certification strings, CA and US.** The MPAA mapping in
  `lib/ageCeiling.ts` only covers G/PG/PG-13/R/NC-17. Canada has no
  national rating system — ratings are provincial, and BC, Ontario,
  Quebec, and the Maritimes all differ — while TMDB returns the country
  code "CA" without saying which board issued the rating. Establish what
  TMDB actually returns for CA before building the mapping; note that
  Quebec's system differs from BC's, so "CA" alone may not be enough to
  resolve a single scheme.
- **Postponement duration.** Is there a cap on how long a membership can sit
  postponed, or a separate "paused" status for a multi-month absence (parental
  leave, deployment) distinct from missing one week?
- **Veto-exhaustion timing.** If every nominee gets vetoed close to the
  nomination deadline, does the picker get a deadline extension to
  re-nominate, or does the round proceed toward lock with nothing decided?
- **Legal review before any public launch.** Three distinct areas, none of
  which block v0 with six friends — all of which block a public launch:
  (1) TMDB terms — attribution wording, the commercial-use threshold, and
  their prohibition on use in AI/ML training; (2) privacy — PIPEDA and BC
  PIPA federally/provincially, plus VPPA exposure in the US for anything
  touching viewing data. Already partly designed for (aggregate-only,
  opt-in, no third-party pixels — analysis-v2.md §1.5) but never reviewed;
  (3) a data-usage policy and terms of service that actually match the
  consent architecture built, not boilerplate. The privacy architecture
  has to be right before there's data to migrate — this can't be
  retrofitted later the way some other things can.
  **Auth is deliberately self-hosted email sign-in** (magic link plus a
  6-digit code per `docs/onboarding-spec.md` §4): no passwords, no
  third-party identity provider — for privacy as much as simplicity. No
  password hashes exist to breach, and no identity provider (Google,
  Apple, Auth0, Clerk) sees who signs in to what. That is **not** the
  same as having no processors: the privacy policy's data-flow section
  must disclose **Brevo** (Sendinblue SAS, France — receives every
  account's email address and every sign-in email; a sub-processor with
  a cross-border transfer out of Canada), **Neon** (hosts the
  database), and **Cloudflare** (hosts the app, sees every request).
  Adding a managed auth provider later means adding a sub-processor
  disclosure — weigh that against the convenience when the time comes.
- **Session and magic-link tokens are stored in plaintext — a known
  gap.** `sessions.token` and `magic_links.token` hold the raw values
  the cookie and the email carry, so anyone who can read those tables
  (a leaked backup, a mis-scoped DB credential) can act as any signed-in
  user without touching a password. The fix is to store a hash (SHA-256
  is enough for high-entropy random tokens; no slow KDF needed) and
  compare hashes on lookup. `docs/onboarding-spec.md` builds its new
  6-digit code hashed from the start; the existing two tokens still
  need the change. Test data only today, so it's cheap now and
  expensive after launch.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
