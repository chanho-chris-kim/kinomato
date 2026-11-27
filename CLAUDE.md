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

- `docs/roadmap.md` — what gets built in what order, each step with its
  status and purpose, and the lawyer's list. The plan lives there, not
  here.
- `docs/analysis-v2.md` — the current analysis: flow, conflicts and their
  rulings, roles, revenue, market, risks. Read this before proposing product
  changes.
- `docs/analysis-v1.md` — superseded. v2 supersedes it wherever the two
  conflict. Retained only for the detailed flow narrative and the conflict
  table in §1.3, which v2 doesn't restate.
- `docs/watchlist-spec.md` — watchlist organisation, add/search flow, the lock
  screen, film metadata sourcing.
- `docs/onboarding-spec.md` — **the rebuild.** No guest tier, email
  code + link sign-in, per-person invites, global watchlists, the public/
  signed-in route split, two-level navigation. Supersedes analysis-v2.md
  §5.1's three tiers and reverses analysis-v1.md §7.1's no-account invite
  loop. Build order is its §8.5; steps 1–7 are all built (the cutover
  removed guests). Launch foundations (§11) follow: (a) legal pages,
  (b) consent, (c) data licensing, (d) age, (e) export, (f) deletion and
  (g) no personal data in URLs and (h) retention are built; what's left
  of housekeeping (§11.6) is dropping `users.avatar` and the unused
  `guest` value of `membership_role`.
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
  scheduled jobs. **The Worker's entry is `worker.ts`, not
  `.open-next/worker.js`:** it re-exports OpenNext's generated `fetch`
  and adds `scheduled` (OpenNext's custom-worker pattern), which runs the
  two Cron Triggers' jobs (`app/scheduledJobs.ts`: the daily retention job
  and the hourly weekly loop). Wrangler bundles `worker.ts`'s imports
  outside Next's bundle, so anything it imports is a second copy: keep that
  import graph small, and **never let it reach Next.js or React**
  (`lib/scheduledGraph.test.ts` walks it and fails naming the chain).
  Inside `scheduled`, `process.env` carries the Worker's vars and secrets
  (`nodejs_compat` with a compatibility date after 2025-04-01; checked
  under ours with `wrangler dev --test-scheduled`, 2026-11-21);
  `DATABASE_URL` is still passed explicitly from the run's `env`.
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
- Auth: email sign-in, sent through **Amazon SES in ca-central-1**
  (`lib/email.ts`; `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`,
  `SES_REGION` defaulting to `ca-central-1`; falls back to a
  console-logged code and link when unset — same shape as
  `TMDB_READ_TOKEN` — and fails loud in production when unset, as
  `AUTH_SECRET` does). **Every email is sent with no open or click
  tracking (ruled 2026-11-22):** SES can only add a pixel or rewrite links
  through a configuration set, `send()` never names one, and
  `lib/email.test.ts` pins that no `ConfigurationSetName` is ever sent.
  Email processing stays in Canada. Requests are signed with
  `lib/awsSigV4.ts` (Web Crypto, checked against AWS's published SigV4
  test suite), no SDK. Brevo is replaced; the cutover is manual,
  `docs/ses-cutover.md`. One email carries a 6-digit code and a link;
  **the code is the primary path** (`/login` → `/login/code`), because
  it's typed into the tab that asked for it, and a link can't reach an
  installed iOS app's separate cookie jar. `/verify` never signs in on
  `GET`: email scanners pre-open links, so only its button does.
  `app/signIn.ts` issues and completes both. No credential is stored in
  the clear (`lib/authCredentials.ts`): session and link tokens as
  SHA-256, the code as an HMAC keyed by `AUTH_SECRET` (a bare hash of a
  6-digit code is cracked in milliseconds). 5 wrong codes kill that
  code, however fast they arrive: **each guess claims one of the five
  tries in one conditional update before it's compared** (fixed
  2026-11-26; before, simultaneous guesses all read the same count and
  were all compared). Sign-in (`app/signInCode.ts`), email change and
  account deletion do the same; `e2e/code-lock-race.spec.ts` sends ten at
  once and expects five comparisons. Sends are limited to one per 30s and 5 an hour per address.
  `AUTH_SECRET` falls back to a fixed dev value outside production and
  **throws in production when unset** — set it as a Worker secret.
  **Changing your email** (Settings, `docs/onboarding-spec.md` §5.9) is a
  code to the new address, entered on `/settings`, held in
  `email_changes`: only `app/emailChange.ts` touches that table, and
  sign-in never reads it (`lib/emailChangeAccess.test.ts`), so a change
  code can never create or sign in to an account. The old address is told,
  with the new one masked and a Reply-To from `SUPPORT_EMAIL`, which
  **throws when unset, everywhere** (no dev fallback): set it as a Worker
  secret; E2E sets a test value. Emails are normalised in one place,
  `lib/emailAddress.ts`. No passwords, no social login. See `docs/onboarding-spec.md` §4 and the
  identity and invite rulings below.
- Web Push (VAPID) with email fallback. No native app.

## Build order

1. Schema, plus `lib/rotation.ts` and `lib/constraints.ts` as pure functions
   **with tests**. These hold the only genuinely tricky logic in the product.
2. One rough page: whose turn, the nominees, voting. Deploy it and get real
   friends using it.
3. RSVP, night confirmation, turn advance.
4. Only then make it look like the prototype.

Built beyond this list as the need became concrete rather than as a
separate planned step: lock (`/clubs/[clubId]`'s "Close voting and set
the pick"), club
creation and invites (`/new`, then per-person invites), and first-night
(`lib/schedule.ts` plus the lazy draft-night creation on `/clubs/[clubId]`
page load — see the ruling below). A club created today reaches its
first nomination with zero hand-seeding: `e2e/first-night.spec.ts` is
the proof, running the whole loop — create, invite, join, watchlist,
nominate, vote, lock, confirm, rate — on data the test itself creates.
v0 is feature-complete; what's left is the Open Questions below.

The purpose of v0 is to find out which rulings below are wrong.

The onboarding rebuild (`docs/onboarding-spec.md` §8.5) is done, and so
are the launch foundations' build steps (§11).

**Next: see `docs/roadmap.md`**, the ordered plan with each step's status
(done, next, later); this file holds the rulings, not the plan.

## Rulings that are load-bearing

Do not quietly change these — they encode decisions that took a while to reach.

- **Rotation is computed, never stored.** Postponement is a membership
  property, not a night state — `postponed_at` on `memberships`. Order:
  `ORDER BY postponed_at IS NULL, postponed_at ASC, last_picked_at ASC NULLS FIRST, joined_at ASC, id ASC`
  over active memberships. The trailing `id ASC` isn't decoration — without
  it, a tie is nondeterministic. A cancelled night is independent of this —
  a night can be cancelled for reasons that have nothing to do with the
  picker. Leaving and rejoining doesn't reset `last_picked_at` or let
  anyone jump the queue: every membership is a user's (`user_id NOT
  NULL`), and a rejoined membership inherits the most recent pick from any
  prior membership of the same user in that club (`lib/rotation.ts`).
  Leaving sets `left_at` and rejoining inserts a new row; at most one
  active row per person per club is a database constraint
  (`memberships_one_active_per_user_per_club`), not just an app check.
  Storing a pointer turns every skip, join, leave and pause into a
  migration problem. **Pass my turn, ruled 2026-11-17:** the picker, or an
  owner or admin for them (the fix for an absent picker stalling the
  club), passes while the night is still a draft. Passing deletes the
  empty draft and sets `postponed_at` to the passed slot (that draft's
  `scheduled_at`). `lib/rotation.ts`'s `isSkippedThisTurn` skips a
  postponed member until a night for someone else at or after that slot
  exists, so the next draft goes to the next person now; then
  `postponed_at` puts them first ("pushed to the front of next week, not
  skipped"). It's cleared when a night is next created with them as
  picker, and if everyone is skipped the rotation still names someone.
  Shown as "Passed this turn" in the rail and Members list until then.
- **Lock is immovable.** After lock, RSVP changes do not re-run the constraint
  filter and the pick does not change. A lock people can't trust is worthless.
  Locking itself (analysis-v1.md §1.1 stage 8) tallies the night's votes and
  writes the winner to `winning_film_id` — two entry points, one shared core
  (`lockNightCore`): a manual "Close voting and set the pick" button, and
  the hourly weekly loop, which locks at the night's stored `lock_at` (see
  "Night deadlines" below). **The button stays as "close now" for owners
  and admins** (ruled 2026-11-21).
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
  (`countSoftPreferenceConflicts`), then the picker's own order
  (`nominations.position`, ruled 2026-11-21: when nobody votes, the
  picker's first choice wins), then nomination id ASC as a last-resort
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
  the ruling above, it just doesn't touch `winning_film_id`. **Until the
  night starts (ruled 2026-11-24, approved by Chanho):** from
  `scheduled_at`, Tonight shows no RSVP, and `setRsvp` is a silent no-op
  for a night that has started, isn't open or locked, or isn't this
  club's (a stale tab). Lock itself is unchanged.
- **A club has at most one night in flight.** `draft`, `open`, and `locked`
  are non-terminal; `watched`, `cancelled`, and `unconfirmed` are terminal.
  Enforced by a partial unique index — `nights_one_in_flight_per_club` on
  `nights(club_id) WHERE state IN ('draft', 'open', 'locked')` — so a second
  in-flight night is a rejected insert, not a UI ambiguity. A page that needs
  "the" open or draft night for a club can look it up with a plain `find`
  and never has to decide between two candidates, because the database
  guarantees there's only ever one.
- **A night's first `draft` row is created lazily, on `/clubs/[clubId]`
  page load** — not a cron, not a button. **Amended 2026-11-22 (approved
  by Chanho), built (r4) 2026-11-23:** the hourly job also creates each
  week's draft night, through the same request-free core the page uses
  (`app/clubs/[clubId]/draftNightCore.ts` `createDraftNightCore`, on
  `getDraftToCreate`: rotation, schedule and anchor, paused clubs skipped,
  ad_hoc never, departed members never picked), so a club nobody visits
  still moves on and gets its "your turn" reminder and its auto-pass.
  Whichever runs first wins: the "one night in flight" index rejects the
  loser's insert (23505, `lib/dbErrors.ts` `isUniqueViolation`), which
  counts as "raced", not a failure. **Never a draft already due to be
  auto-passed (ruled 2026-11-23):** if a slot's `scheduled_at − lockTime`
  has gone by, `getDraftToCreate` skips that slot and drafts the following
  one, for the page and the job alike. Otherwise the next hour's step (c)
  would pass it, then the next picker the hour after, down the rotation. If the club has no
  non-terminal night and `getNextPicker` resolves someone, that request
  inserts a `draft` night for them with `scheduledAt` from
  `lib/schedule.ts`'s `getNextOccurrence`; `lib/clubStatus.ts`'s
  `getDraftToCreate` decides. The signed-in `/` calls the same function
  to show a club's next night and whose turn it is, **for display only**:
  only the club page and the hourly job insert the row. The "one night in flight" index turns
  a race between two simultaneous page loads into a rejected insert on
  the loser, caught and re-read rather than thrown — same shape as
  confirmNight and lockNight losing a race to each other. `ad_hoc`
  clubs can't lazy-create (no standing day/time to compute from) and get
  their own explicit "no night scheduled" state, not a broken-looking
  blank one — and there's no UI yet to schedule one for them manually.
- **"Whose turn" names who the club is waiting on: the in-flight night's
  picker.** When a club has a `draft`, `open` or `locked` night, Tonight
  names that night's picker (since the Tonight redesign, 2026-11-25, in
  the "do this now" card's text and the side column, not a heading). Only with no night in flight does
  it fall back to `getNextPicker`, which stays as it is, because "who
  picks next" is a different and correct question: it counts the
  in-flight night as already picked and names the member after its
  picker. `lib/rotation.ts`'s `getWhoseTurn` implements this. The club
  page computes it *after* any lazy draft insert, so the load that
  creates a draft and every later load give the same answer. That
  keeps the heading agreeing with "Waiting on Mika to nominate" one
  line below, instead of contradicting it, which is what it used to do
  on every load after the first. Two edge cases, both ruled: **a paused
  club still names the in-flight picker** — pausing stops the rotation
  from moving on, it doesn't end the night someone is holding, so the
  club is still waiting on them; and **a picker who has left mid-turn is
  still named** — leaving isn't handing the turn off, and nothing else
  resolves their night, so naming anyone else would claim a handoff that
  never happened. In both cases the heading only moves once the night
  itself resolves (watched, cancelled, or unconfirmed). **Amended
  2026-11-11: the departed-picker part covers open and locked nights
  only.** Those carry on with the departed picker still named. An *empty*
  draft (no nominations) whose picker leaves or is removed is deleted in
  the same batch as their departure, so the next Tonight load drafts for
  the next picker; it no longer waits on someone who left.
- **`lib/schedule.ts`'s "monthly" means the Nth occurrence of a weekday,
  not a calendar day.** `clubs` only stores `default_day` (a weekday),
  not a day-of-month, so "the 2nd Saturday of the month" is the only
  reading "monthly" + a weekday picker can support — chosen because it's
  what most recurring-meetup products mean by that combination, not
  because it's the only defensible choice. When the Nth occurrence
  doesn't exist in a later month (a "5th Friday" club hits a 4-Friday
  month), it clamps to that month's last occurrence rather than skipping
  the month — skipping would make the club's own page look broken one
  month most years. **The counting starts from `settings.scheduleAnchor`
  ("First night on", ruled 2026-11-10) when a club has one, else from
  `created_at`.** Changing a biweekly or monthly club's cadence or day, or
  switching to either, requires that date (on the chosen weekday, not
  past), so the week parity or the Nth weekday is always one somebody
  chose. DST correctness (get 8pm local right on both sides
  of a transition) is the part of this module that's actually tested
  hard; the monthly interpretation is a reasoned judgment call worth
  revisiting if it doesn't match what a club expects.
- **A cancelled night does not consume a turn.** A lost vote does — but all
  nominees belong to the picker, so they can only lose *which* of their films.
- **Never auto-advance as if confirmed.** No answer within the window logs the
  night as `unconfirmed`. History integrity is what makes the rotation
  trustworthy. Auto-advance is always on a bounded timer (24h / 48h / 7 days) —
  never offer "never" as an option. A club stalled forever on one picker is a
  dead club. **Ruled 2026-11-19:** a night nobody confirms is marked
  `unconfirmed` automatically. It consumes the picker's turn (the rotation
  moves on; `lib/rotation.ts` already counts it), but it is never recorded
  or counted as watched anywhere: History's watched rendering, the "club
  watched this" badge, ratings, export, any future aggregate (each reads
  `state = 'watched'` only). This supersedes `docs/prototype.html`'s "the
  week logs as unconfirmed and Sam keeps the turn".
- **Night deadlines (ruled 2026-11-21, `lib/nightDeadlines.ts`).** Stored
  on the night, so a settings change never moves a night already open or
  locked; the settings form says so.
  - **Voting closes** at `nights.lock_at`, written when voting opens:
    `min(max(scheduled_at − lockTime, now + 6h), scheduled_at)`. Everyone
    gets at least 6 hours unless the night itself comes first; voting
    never closes after the night starts. `lockTime` (club setting): 1, 3,
    6, 12, 24, 48 or 72 hours, default 24.
  - **Unconfirmed after** `nights.unconfirm_at`, written at lock:
    `max(confirmableAt ?? scheduled_at, locked_at) + autoAdvance`.
    `autoAdvance`: 24, 48 or 168 hours, default 48; never "never".
  - **Durations are absolute hours**, so across a DST change they're
    23/25 or 47/49 hours on the clock.
  - **`nights.unconfirmed_at`** records when a night became unconfirmed,
    and is kept even if a late "yes" later makes it watched.
  - **The picker's order** is `nominations.position` (1 = first choice),
    written when voting opens in the order they selected their films;
    lock's tiebreak uses it before id.
  - **A picker who never opens voting:** if a night is still a draft at
    `scheduled_at − lockTime` (when voting would have closed), the job
    passes their turn exactly as Pass my turn does (p1's postponement,
    "Passed this turn"), through the same request-free core
    (`app/clubs/[clubId]/passTurnCore.ts` `passDraftCore`, which
    `passMyTurn` and `passTurnFor` call too).
  - **Late confirmation (built w4, 2026-11-21):** any active member may
    answer only "Yes, we watched it", for 7 days after a night becomes
    unconfirmed (`unconfirmed_at`), and only while no later night has
    finished; a late "No" is refused (letting it un-consume the turn would
    reward waiting out the timer). It moves `unconfirmed → watched` with
    `confirmed_by` that member and `confirmed_at` now, keeping
    `unconfirmed_at`; the rotation doesn't change. Ratings then open the
    normal way (it's the club's latest watched night) and History shows it
    watched. `lib/clubStatus.ts` `findLateConfirmableNight` (on
    `lateConfirmOpen`) drives Tonight's "Did you watch X after all?" (Yes
    only), the `/` card's status of the same words (an action, after
    "Did you watch X?") and `confirmNight`'s own check: "watched" may move
    a locked night, or that unconfirmed one; "didn't watch" only a locked
    one. The update is conditional on those states, so with the job
    logging the night unconfirmed in the same instant, "watched" lands
    either way. A refused answer, or one that lost a race, still refreshes
    the page, so a stale tab shows the night as it now is. The tag page
    reads `state = 'watched'` only, defensively.
  - Tonight shows "Voting closes {day time}" on an open night and, on a
    locked one, "If nobody answers by {day time}, this week is logged as
    unconfirmed and the turn moves on." Nights from before the columns
    existed get a fallback from today's settings (`effectiveLockAt`,
    `effectiveUnconfirmAt`), the same one the job acts on.
  - **The hourly weekly loop (built w3 + w5, 2026-11-21,
    `app/weeklyLoop.ts` `runWeeklyLoop`).** Cron Trigger `0 * * * *`
    beside retention's `0 10 * * *` (the Free plan allows 5 per account),
    dispatched by `controller.cron` (`app/scheduledJobs.ts`). Each run, for
    every club's night in flight, **paused clubs included** (pausing never
    ends the night in flight): (a) open nights past `lock_at` →
    `lockNightCore`, **at most 5 a run**, oldest deadline first, the rest
    an hour later; (b) locked nights past `unconfirm_at`, with the prompt
    showing under current settings → `unconfirmed`, `unconfirmed_at` =
    `confirmed_at` = now, `confirmed_by` NULL (the clock did it), written
    `WHERE state = 'locked'`; (c) drafts at or past `scheduled_at −
    lockTime` → `passDraftCore`; then (e) clubs with nothing in flight →
    `createDraftNightCore`, **at most 10 a run** (`DRAFTS_PER_RUN`; up
    to 50 candidates looked at, oldest club first), after a/b/c so a night
    that just resolved gets its successor in the same run (r4, 2026-11-23,
    see the lazy-creation ruling); then (f) reminder emails (see the
    reminder ruling under "Two pushes per week"). Due-ness is `lib/nightDeadlines.ts`
    (`dueToLock`, `dueToUnconfirm`, `dueToAutoPass`). **Every write waits
    on the night's state**, so a person pressing the same button in the
    same instant leaves one result and the other side a no-op, and a
    second run changes nothing. Each night is tried on its own; failures
    are collected and thrown at the end, so the run shows as failed. One
    log line, `[weekly-loop] {"locked":n,"unconfirmed":n,"passed":n,"drafted":n,"reminded":n,"remind_failed":n,"failed":n}`
    (the same counts in the ops alert),
    plus one line per failed night with its id and what failed, never a
    name, email or row data. Tested by calling the job directly with a
    chosen `now` and `clubIds` (`e2e/weekly-loop.spec.ts`); production
    never passes `clubIds`.
  - **Ops alert (w5).** A failed run of either job emails `SUPPORT_EMAIL`
    (`lib/email.ts` `sendOpsAlert`, fails loud if unset): the job, the time
    and the run's counts only, never an error message or row data, and
    "See Workers Logs". Then the run still fails. **Where to look:**
    Workers & Pages → kinomato → Settings → Trigger events (both
    schedules, and the Cron Events list of each run's outcome), and Logs
    (the `[weekly-loop]`/`[retention]` lines, each run's `cpuTime`).
  - **CPU on the Free plan: 10 ms per Cron run.** An idle run is one
    query. A lock is about ten queries plus a batch; on Workers a
    subrequest's network time isn't CPU, so the cost is query building
    and JSON, estimated at 1–2 ms a lock and well under 1 ms per
    unconfirm or pass. That puts a five-lock run near the limit, which is
    why the cap is 5. **Unmeasured on Workers:** Node measured 179 ms for
    five locks, inflated by its own TLS and HTTP-client work that Workers
    doesn't bill as CPU. Read `cpuTime` on the first runs in Logs; if a
    run exceeds 10 ms, lower `LOCKS_PER_RUN` or move to Workers Paid (30 s
    a run). Every write is conditional, so a run cut short is safe to
    repeat.
- **Constraints: hard vs soft.** Hard limits are never overridden and never voted
  on, capped at two per person. Soft preferences warn and break ties, never block.
  Scoping is asymmetric: a hard limit applies to everyone who has **not
  explicitly RSVP'd no** — no answer counts as attending, because silently
  dropping an unanswered person's hard limit is how they end up watching the
  one thing they can't. A soft preference applies only to explicit
  yes-RSVPs. `applies_when_absent` overrides both. **A member who has
  left stops counting (ruled 2026-11-09):** once `memberships.left_at` is
  set (leaving, removal, or account deletion), their hard limits and soft
  preferences no longer apply at lock, and their RSVP no longer scopes
  anything (`lib/constraints.ts` `scopeToActiveMembers`, used by
  `lockNightCore`). Their votes, nominations and ratings already cast stay
  and count: they were cast while a member, and the record keeps them.
  Hard limits take the same scoped input (`lib/eligibility.ts`, ruled
  2026-11-12; see "Where hard limits apply").
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
  silent. An unrecognized club setting (a club's audience, say) throws a
  descriptive error rather than silently emptying the eligible pool —
  that's our bug, not a fact about the film. Validate configuration values
  at settings-write time so this can't be stored in the first place; the
  throw is defense in depth, not the primary guard. **Amended 2026-11-24
  (approved by Chanho), for film data only:** a certification TMDB returns
  that nothing maps is data about a film, not configuration. It's treated
  as unknown, so not suitable (fails closed), and counted in the logs; it
  never throws, since a throw would break a whole club's page over one
  film. See "Age-appropriate films".
- **Never surface constraint causality in the UI.** The eligible pool just is what
  it is. Never "horror unlocked because Dana is away." **Ruled 2026-11-12:
  nobody but the person sees their limits**, not the owner, not admins;
  soft-preference warnings never name anyone ("Someone coming
  would rather not"), superseding `analysis-v1.md`'s "Dana would rather
  not". The picker sees fewer films with no count and no reason; a list
  the limits empty says "None of your watchlist fits this club right now.
  Add a few more films." and names nobody.
- **Soft-preference warnings during voting (ruled 2026-11-18,
  `lib/preferenceWarnings.ts`).** While a night is open, a nominee shows
  "Someone coming would rather not." when at least one active member
  who explicitly RSVP'd yes has a soft preference it matches
  (`countSoftPreferenceConflicts` over `scopeToActiveMembers`). Never a
  name, a count, or which preference; the viewer's own preference counts
  like anyone's and still reads "Someone". **Anonymity threshold:** only
  when at least three active members other than the viewer have RSVP'd
  yes; below that, "someone" could identify a person, so nobody sees it.
  **Genre and runtime preferences only**: a topic (keyword) preference
  can reveal a sensitivity, so it never warns, though it still breaks
  ties at lock. Open nights only: never on the nomination screen, a
  locked or finished night, or History.
- **Where hard limits apply (ruled 2026-11-12, `lib/eligibility.ts`).**
  At nomination, every active member's hard limits filter the picker's
  list (`nominatableFilms`; a draft has no RSVPs, so all count), and
  `openVoting` re-checks through the same function. Nothing re-filters
  during voting. At lock, once, scoped by RSVP: nominees a hard limit now
  excludes are dropped (`nominations.dropped_at`) and the pick comes from
  the rest; if none remain, the night is cancelled with no pick, the
  same picker drafts again, and votes are kept. History's tally leaves
  dropped nominees and their votes out. Lock stays immovable: all of this
  happens inside the one lock, which still only runs on an open night.
  **A limit added or removed takes effect at the next point it's checked
  (ruled 2026-11-12):** the next nomination, or the lock of a vote already
  open. **Only the person sees and changes their own limits**: the
  limits page (`/clubs/[clubId]/members/limits`, u6) renders the viewer's
  own membership only, and `addLimit`, `removeLimit` and
  `setLimitsApplyWhenAbsent` act on the signed-in person's membership,
  never a client-supplied one. Write-time validation is
  `lib/constraintForm.ts`; the two-hard-limit cap is also enforced by a
  conditional insert; the "weeks I'm out" switch is written to every one
  of the person's rows. **Topic limits, ruled 2026-11-12:** keyword
  limits come only from the curated list in `lib/contentTopics.ts`, never
  free search; the app never calls TMDB's keyword search at runtime, so
  nothing a person types reaches TMDB, a URL or a log. A topic's ids are
  stored comma-separated in `constraints.value` and match a film with any
  of them; a film with no keywords fails closed for a hard topic limit.
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
  costs nothing; a veto is a choice and costs a token. **Deferred until
  seasons are designed (ruled 2026-11-19).** The token pool is per member
  per season, and a season has no start, end or length yet; without
  one, a cap can't be enforced, and vetoes without a cap would be free
  and unlimited, against "a veto costs a token". So no veto UI ships
  before seasons do. `castVeto` stays as the seam it is (see Open
  Questions).
- **No full attendance ranking, ever.** Top attendees or a personal streak only.
  A ranked list ending in last place is how you lose the member with a newborn.
- **History is shared and symmetric.** Every member sees the same club
  history — no admin-only view, no hidden data, consistent with there being
  no admin tier over data access. It contains every night (film, date, week
  number — not derived yet: week numbers wait until seasons have a
  defined start and length, and History omits them until then — picker,
  state including `cancelled` and `unconfirmed`), the final
  tally, both rating axes, hot takes, and who attended each individual night.
  It does **not** surface: individual vote attribution after lock (live
  counts are visible during voting only when the club's "Show vote counts
  while voting is open" setting is on, ruled 2026-11-25; once voting
  closes, keep "won 4-1" and drop who voted for what); the vetoer's name after the night ends (named
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
  reminder to omit it: **`app/clubs/[clubId]/historyRead.ts`** (built in
  rebuild step 5f). It is the only code that reads the votes and vetoes
  tables, and nothing it returns carries a `membership_id` from them:
  `liveVotes` (an open night's counts plus *your own* vote, pre-lock
  only — Tonight's tally), `viewerVotedOnOpenNights` (the club cards on
  `/`), `votesForLock` (nomination ids for `lockNightCore`'s tally),
  `closedTally` (a night's final counts once voting has closed, for
  Tonight's "Won 3 to 1", u1) and `clubHistory` (finished nights' final
  counts and a veto count, never voters or vetoers). **Enforced by a test:** `lib/attributionAccess.test.ts`
  scans `app/` and `lib/` and fails, naming this ruling, if any other file
  imports `votes` or `vetoes` from `db/schema`, reaches them through a
  namespace import, or names them in SQL. The one exception is the
  club's server actions (`app/clubs/[clubId]/actions.ts`), which import
  them to *write* (cast or move a vote, cast a veto) and may never read
  them. **One recorded exception (2026-11-07, `docs/onboarding-spec.md`
  §11.4; widened 2026-11-11, §5.10):** when a club's last active member
  deletes their account, or deletes the club from the Members tab (by
  typing its exact name), the club goes whole, its votes and vetoes
  included. With no member left there's no one to audit for, and people
  who left the club earlier lose its history too. That delete is
  `historyRead.ts`'s `deleteVotesAndVetoesOfClubs`, inside
  `app/clubDeletion.ts`'s `clubDeletionStatements`, which only those two
  paths run.
- **Which films a club can see goes through one function.** One
  watchlist per person (`watchlist_items.user_id`, docs/onboarding-spec.md
  §6), so what each club sees of it is decided in exactly one place:
  `lib/watchlistVisibility.ts`'s `visibleToClub`. Today it returns every
  item (§6.2: no per-club hiding in v1), and a test pins that.
  `app/watchlistRead.ts` is the one loader of other people's
  `watchlist_items` and passes every result through it:
  `clubVisibleItems` (active members' lists only), `overlapByFilm` (§6.3:
  distinct active members, via `lib/watchlistOverlap.ts`; shelves count
  you, the search badge counts others) and `nominatableFilms` (Tonight's
  picker and `openVoting`'s server check) and `helpFilmsFor` (Tonight's
  "Films your club wants that fit everyone", ruled 2026-11-17: others'
  visible, eligible films, counts only, never names). **Choosing clubs
  when adding a film** (future, ruled 2026-11-24): one club, several, or
  all, default all, built through this seam (`docs/onboarding-spec.md`
  §10). **Enforced by a test:**
  `lib/watchlistAccess.test.ts` fails, naming this ruling, if any file
  other than the loader and the own-list files (`app/watchlist/page.tsx`
  and `actions.ts`, which touch only the viewer's own rows) touches
  `watchlist_items`. **Per-club lists or
  folders** (§6.2's later feature, §10) are planned, not built: they add
  one table, loaded by `app/watchlistRead.ts` into `ClubVisibilityRules`
  and applied in `visibleToClub`, with no call site changing. A film
  detail's "who else wants it" (`whoElseWants`) is a named slot in the
  loader, to build when that panel exists. Adding or removing a film is
  still never a club-visible event (history ruling).
- **Launch foundations are ruled (`docs/onboarding-spec.md` §11,
  2026-11-06), and nothing public launches without them.**
  - **Terms and Privacy** are versioned in one place, `lib/legal.ts`.
    Acceptance is an explicit checkbox naming the current versions; **any
    version change blocks every signed-in page until re-accepted**. Gating
    starts with the draft texts; the reviewed text is a version change.
    **No public sign-ups until a lawyer has signed off the text.**
  - **Sign-up is invite-only until then (ruled 2026-11-18,
    `lib/signupGate.ts`).** A new account is created only through a valid
    personal invite (`startInvite` → `completeSignIn` with its
    `inviteId`, the invite still unredeemed and unrevoked). Existing
    accounts sign in as normal and can still create clubs. An address
    with no account at `/login` gets the same code screen as everyone (no
    enumeration), counts against the same send limits, and is emailed
    "Kinomato is invite-only for now. Ask a member of a club to invite
    you." instead of a code: its `magic_links` row holds a code hash no
    6-digit code matches and a token never sent. `completeSignIn` never
    creates an account without a live invite, whatever code or link
    reaches it. One server setting, `OPEN_SIGNUP`: exactly `"true"` opens
    sign-up, anything else (unset included) keeps it closed. The signed-out
    marketing page shows "Invite-only for now" in place of Start a club
    while closed. E2E runs closed; `e2e/open-signup.spec.ts` runs against
    CI's open-signup server, and specs whose founder signs in fresh start
    from a bare account (`e2e/signIn.ts` `existingAccount`).
  - **Data licensing** is a separate checkbox, default unchecked, never
    bundled into the Terms; aggregates only; withdrawal is future-only;
    **13–17s can't opt in.**
  - **Age** is a self-attested bracket, never a birthdate. **Under 13,
    nothing persists**: the account, its sessions and any just-created
    membership are removed, and no record of the attempt is kept.
  - **Deletion anonymises** (§11.4's table): "Former member", email
    released, personal lists deleted, scores kept but takes and tags
    removed, memberships marked left, attribution kept. Confirmed by a
    code to the account's address. A club you own with others left passes
    to its earliest admin, else its earliest member; a club you're the
    last active member of is deleted whole (the attribution exception
    above).
  - **Export** is your own data only, as JSON, never anyone else's names
    or votes; your own votes come through the history-read module.
  - **Built: (a)–(h).** The gate is inside `app/auth.ts`'s
    `requireUser` (so `requireNamedUser`, `requireClubMember` and the club
    actions' `requireCurrentMembershipId` all carry it): an account
    missing a current acceptance or its age goes to `/consent`, or
    `/welcome` if unnamed. Exempt: `/terms`, `/privacy`, `/consent`,
    `/welcome`, sign-in, the invite landing, `/age-limit` and both sign-outs
    (`requireSignedInIgnoringConsent`, nowhere else).
    `lib/consentGate.test.ts` fails any page, route or server action that
    skips it. `consent_events` and `data_licensing_consents` are
    append-only; status is the newest row (`lib/consent.ts`). An opt-in
    counts only for the wording version it was given against. Under 13 on
    `/welcome` hard-deletes the new account and un-redeems its invite
    (`app/consent.ts` `discardNewAccount`); on `/consent` it runs §11.4's
    anonymisation (`app/anonymise.ts`), the module (f) reuses.
  - **Retention (§11.6, built (h)).** A Cron Trigger, `0 10 * * *`,
    runs `worker.ts`'s `scheduled` handler → `app/scheduledJobs.ts` →
    `app/retentionCleanup.ts` (one batch; cutoffs in `lib/retention.ts`;
    guarded tables through their owners). Never reachable over HTTP. One
    `[retention]` log line of counts per run; failures throw, after the
    ops alert (see "Night deadlines"). Its graph is free of Next.js since
    2026-11-21: `confirmEmailChange` takes ending the other sessions as a
    callback from its action, so `app/emailChange.ts` no longer imports
    `app/session.ts` (cookies).
  - **Delete account (§11.4, built (f)).** `app/accountDeletion.ts`, the
    only code touching `account_deletion_requests`
    (`lib/accountDeletionAccess.test.ts`); `lib/accountDeletion.ts`'s
    `planDeletion` decides leave, transfer or delete per club. One batch:
    transfers, last-member club deletion, then `anonymisationStatements`.
    The receipt goes to the old address after the batch lands.
  - **Download my data (§11.5, built (e)).** `GET /settings/export`,
    gated by `requireUser`, no query string. `app/dataExport.ts`
    assembles the file from queries filtered to the person; own votes and
    vetoes come from `historyRead.ts`'s `ownVotesAndVetoes`, own watchlist
    from `ownWatchlist`, own email changes from `ownEmailChanges`.
    `lib/dataExport.ts` shapes it by named fields only: never another
    person's name, email or vote, never a hash, token or code.
  - **No personal data in URLs (§11.6, built (g)).** Workers Logs keep
    every request URL. The sign-in address rides in `kinomato_signin_email`
    (`app/signInCookie.ts`, `/login` only, 15 minutes); a form's typed
    values come back after an error through `kinomato_form_echo`
    (`app/formEcho.ts`). `?error=` messages and `returnTo` paths stay in
    URLs. `lib/noPersonalDataInUrls.test.ts` fails anything else.
- **Every rating is a verified member's.** There are no guests since the
  step-4 cutover: every rating comes from an account behind a verified
  email, and every non-founder arrived by a personal invite
  (`invites.invited_by_membership_id` is the provenance record —
  `docs/onboarding-spec.md` §3). Public aggregates, when they exist,
  weight by trust; the founder is the open edge, covered by "a brand-new
  club can't move a film's public number" (analysis-v2.md §5.2).
- **Blind reveal: a member's whole rating — both scores and any hot take —
  stays hidden from everyone else until every attending member has rated.**
  Hiding only the text and not the quality/fun scores wouldn't stop
  anchoring, since a visible 9/10 biases the next rater as much as a
  written take does. "Attending" means an explicit yes-RSVP, matching the
  constraint scoping asymmetry — someone who never answered didn't
  necessarily watch. **Only members still active are waited on (ruled
  2026-11-09):** a yes-RSVP from someone who has since left (left, removed,
  or deleted their account) no longer holds the reveal back. One function
  decides who must rate, `lib/ratingReveal.ts` `mustRateBeforeReveal`,
  used by Tonight, History (`historyRead.ts`) and the tag page. That set
  only shrinks (a rejoin is a new membership row), so a revealed night
  never goes back to hidden. This is a different mechanic from analysis-v1.md's
  "spoilers for absent members" (blurred until *you* mark yourself as
  having watched it) — that one protects someone who missed the night,
  this one protects the group's honesty while everyone's still rating.
  Both can be true at once; only this one is built in v0.
- **"I was there" (ruled 2026-11-24, approved by Chanho; built with the
  Tonight redesign).** A member who didn't RSVP no can join the rating step
  until the night's ratings are revealed, and is then waited on like any
  yes-RSVP. Never after the reveal: a revealed night never goes back to
  hidden. RSVP itself still closes when the night starts. This answers
  "rating after a missed RSVP": someone who came without answering can
  still rate.
- **Two pushes per week per member, across all their clubs — not per club.**
  Plus one extra on their picking week. Notifications dedup across clubs someone
  belongs to. Everything else is in-app. This is a product constraint, not a
  setting. **Reminder emails, ruled 2026-11-22 (built in the reminders
  steps):** the same cap applies to them. They default on for friends,
  with an unsubscribe that's easy to find: normal body-size text near the
  top of every reminder ("Don't want these? Turn off reminders"), a footer
  with "Mute only this club", and a one-tap page with two large buttons.
  Whether reminders need express consent under CASL is on the lawyer's
  list (see Open Questions). **Preferences and the unsubscribe page, ruled
  2026-11-23 and built (r1):** Settings "How we reach you" is one switch,
  `users.email_reminders` (default on), plus "Mute reminders from {club}"
  (`memberships.reminders_muted_at`), with "Sign-in codes and account
  notices always arrive." (those never look at these settings).
  `lib/reminderPrefs.ts` `mayGetRemindersFrom` decides who a club's
  reminders could go to. An unsubscribe link (`/unsubscribe/[token]`) is
  public, works signed out, is exempt from the consent gate (it can only
  turn reminders off), and changes nothing on GET: its two large buttons
  POST. Its token is 256 random bits, never an email, name or id, stored
  only as a hash, tied to one person and one club, dead after 90 days and
  deleted by retention; account and club deletion remove tokens. Only
  `app/reminderUnsubscribe.ts` touches `reminder_unsubscribe_tokens`
  (`lib/reminderTokenAccess.test.ts`); reminder emails call its
  `createUnsubscribeLink(db, userId, clubId, origin)`.
  **Reminder emails, built (r2 + r3), ruled 2026-11-23:**
  - **Budget:** at most 2 reminder emails per person per rolling 7 days
    across all clubs, plus 1 "your turn" per night they pick. Sign-in,
    account notices and ops alerts never count. Over budget is dropped,
    never queued (a later run may still send it if a slot frees while its
    window is open).
  - **Kinds, priority order (the first two that apply win):** (1) "Voting
    closes soon": active members who haven't voted on that open night,
    `lock_at − 24h` to `lock_at − 1h`; (2) "Movie night is tonight": a
    locked night, not to anyone who RSVP'd no, 08:00 on the night's day to
    `scheduled_at − 1h`; (3) "Did you watch it?": a fill-in only if a slot
    is left, to yes-RSVPs, from the prompt (`confirmableAt`, or the night)
    to `unconfirm_at − 6h`, not once answered. Plus the picker's "Your turn
    to pick": a draft, until `autoPassAt − 6h`, not once voting opened.
    Each is re-checked just before it's sent; a moot one never goes.
  - **Quiet hours 22:00–08:00** in the club's timezone: a due reminder
    waits for 08:00 if its window is still open.
  - **The same kind due for several clubs in one run is one email**,
    listing the clubs, counting once (its log rows share a `send_id`).
  - Only to people `mayGetRemindersFrom` allows.
  - **Content:** plain and short, one link per club to `/clubs/{id}`; never
    a film title, name, vote, count, RSVP list, limit or preference. Near
    the top, in body-size text, "Don't want these? Turn off reminders";
    the footer "At most two reminders a week across your clubs." and "Mute
    only {club}" per club; a plain-text part.
  - **One-click unsubscribe (RFC 8058):** every reminder has
    `List-Unsubscribe` (`/unsubscribe/{token}/one-click`) and
    `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. A POST with that
    body stops all reminder emails, no confirmation page; a browser GET
    there is sent to the two-button page and changes nothing (the same
    path can't be both a page and a POST handler in Next.js, hence the
    sibling URL).
  - **Log:** `notification_log` (user, kind, club, night, `send_id`,
    sent_at), a `uniqueIndex` per (user, kind, night). Claimed, then
    sent; a failed send releases its claim so the next hour retries. Only
    `app/notificationLog.ts` touches it (`lib/notificationLogAccess.test.ts`);
    retention deletes rows after 30 days; the export has your own rows;
    account and club deletion remove them; a deleted night takes its rows
    (cascade).
  - **"Who hasn't voted"** comes from `historyRead.ts`
    `membershipsYetToVote`: only ids, only on an open night.
  - **Step (f) of the weekly loop**, after a–e, at most 20 emails a run,
    each on its own; `reminded` and `remind_failed` are in the log line
    and the ops alert, and a failed send fails the run without undoing
    a–e. Links use `APP_ORIGIN` (a plain var in `wrangler.jsonc`); unset,
    no reminder goes and the run fails. Pure rules in `lib/reminders.ts`;
    orchestration in `app/reminders.ts`.
- **No tracking or behavioral ads, ever (ruled 2026-11-24, approved by
  Chanho; his decision, permanent).** It strengthens the privacy rulings
  (no third-party pixels, aggregate-only data licensing, no tracking in
  any email). Ads are contextual and privacy-safe only: no third-party
  trackers, pixels or cookies, and nothing that sends viewing data (film
  titles, watchlists, votes, ratings, RSVPs) to an ad provider. Never
  behavioral, for anyone, of any age. **Direct-sold sponsorships are the
  long-term ad model.** Ad slots are placed by design, never as filler.
  **Never inside a private club** (`analysis-v2.md` §1.3, unchanged, and
  re-affirmed 2026-11-24): the redesign's one slot is designed into global
  pages (the Clubs list, Watchlist) and, later, public clubs, never into a
  private club's Tonight, History or Members.
- **Age-appropriate films (ruled 2026-11-24, approved by Chanho; built in
  `docs/roadmap.md` a1–a6).** It reverses "family mode is dead, no
  successor" (`docs/onboarding-spec.md` §0) and `analysis-v1.md` §8's
  "keep it out of v1", **for 13–17 support only** (Chanho's decision).
  There are still no accounts under 13.
  - **Audience**, in `clubs.settings`: All ages (13+) or Adults only
    (18+), owner or admin, like the other club settings. Adults-only clubs
    refuse 13–17 members (invites and joining).
  - **All-ages clubs allow only films at "teen" level or below**, as a
    club rule that applies whoever is in the club, so it never reveals
    anyone's age. It's a club filter, not a member constraint, applied
    where hard limits are: nomination, `openVoting` and lock, and "Films
    your club wants".
  - **13–17s only search and add teen-or-below films.**
  - **Levels:** US G and PG, and CA G and PG → all ages; US PG-13 and CA
    14A → teen; US R and NC-17, and CA 18A, R and A → adult. Within one
    country, the most restrictive release entry wins; across CA and US,
    the stricter of the two wins. No rating, NR, E, or anything
    unrecognised → unknown → not suitable, counted in the logs and never
    thrown (the missing-data amendment above). Stored per country in
    `film_certifications(film_id, country, certification)`, as decided in
    advance. A GB/AU fallback is deferred.
  - **Ratings are re-checked weekly for about a year after release**, a
    narrow exception to "film metadata caches indefinitely": TMDB adds
    ratings after release.
  - **Existing clubs become Adults only**, unless an active member is
    13–17; then All ages.
  - **13–17s can self-attest up to 18+ in Settings, upward only.**
  - A refused switch to Adults only says only "This club can't be
    adults-only right now." It never says why or names anyone.
- **Free tier caps a club at six members**, enforced server-side twice:
  when an invite is created, where **pending invites hold a seat**
  (`lib/invites.ts`'s `canCreateInvite`: active + pending < 6), and when
  one is redeemed, which re-checks active members only (`canAddMember`
  in `app/invites.ts`'s `redeemInvite`) — an invite can sit unredeemed
  while the club changes. A refused invite is never a silent no-op: the
  club page names the limit instead of offering the form, and a full
  club's invite link says so and stays unconsumed. Checked with plain
  count queries, not a DB constraint — a soft business-tier cap, not a
  safety invariant like "one night in flight," so a race under truly
  simultaneous redemptions is an accepted gap, and the cap is meant to
  change per plan once paid tiers exist, which a fixed DB check can't
  express as easily as an application-level read.
- **A name is one free-text display name (built u2, 2026-11-26; it
  replaced "first name + last initial", see "Display name" below).** It
  lives on the account (`users.display_name`), one per person, the same in
  every club — memberships carry no name. Null only until the name step
  (`/welcome`), so it can't be NOT NULL: an account exists before it names
  itself. `lib/displayName.ts` holds the rules: `validateDisplayName`
  (trimmed, runs of spaces made one, 1–30 characters as people see them,
  no control characters, and not "Former member" or "Unnamed member", the
  app's own names), `nameKey` (the comparison: NFKC, case-folded, one space
  between words), `findClash` and `shownName` (the display name, else
  "Unnamed member"), which `nameOf` (`app/clubs/[clubId]/members.ts`), the
  club cards and the deletion receipt all go through. **Unique within each
  club among active members**, checked in the server actions that join or
  rename (`app/displayNameClash.ts`): joining checks that club, inside
  `redeemInvite`; a rename checks every club the person is in and names
  the first that clashes, by club name. Someone who has left (left,
  removed, or deleted: "Former member") never counts. A clash says
  "Someone in {club} already goes by {name}. Pick another.", carried by the
  form-echo cookie with only `nameTaken=1` in the URL. **An account with
  no name yet joins at the name step**, once its name is accepted: sign-in
  from an invite no longer redeems before `/welcome`, so a clash, or Under
  13, creates nothing. An already-named account that clashes gets the
  invite page's "Pick another display name" form (`joinInviteWithName`).
  Two people choosing one name in the same instant is an accepted gap, as
  with the seat cap. No email is ever shown to a club.
- **A new club gets a distinct first-run prompt, not a generic empty
  state.** On Tonight (`/clubs/[clubId]`), while the owner is the only
  member and no night has ever finished, an owner or admin sees "Add the
  people you watch with." with a link to the invite page
  (`/clubs/[clubId]/members/invite`, u4). **A club started since u4 gets
  the owner's "Get {club} going" checklist instead** (see "Own sign-up"),
  which takes this prompt's place while it shows. "No nights at all" can't be
  the test: the first page load lazily creates the owner's draft night
  (the lazy-creation ruling above). A club with nobody active to pick
  still gets its own "No night scheduled yet" state, pointing at the
  Members tab; anything else with no night in flight gets the generic
  "No open vote right now".
- **How this club runs (club settings) and pause, ruled 2026-11-10**
  (`docs/onboarding-spec.md` §5.10). ~~Every member sees the settings~~
  **Amended 2026-11-27 (u6, approved by Chanho): only owners and admins
  see them**, on `/clubs/[clubId]/members/settings`; anyone else gets a
  404. **Owner and admin change them, with equal powers**, through the one
  role gate in `app/clubs/[clubId]/actions.ts` (`requireOwnerOrAdmin`,
  also used by closing voting and invites), re-checked on every call.
  **Changes apply from the next time they matter and never rewrite a
  night in flight**: films per turn is read when the picker next opens
  voting; the confirm timing applies to the next confirmable night.
  Written values are validated at write time
  (`lib/clubSettings.ts` `readClubSettingsForm`, merged into the JSONB
  by `mergeClubSettings`, other keys kept). **Pause/resume is owner or
  admin** and never ends the night in flight; nothing new is drafted
  while paused, and resuming lets the next Tonight load draft one.
  **Club details (name, how often, day, time, timezone, mode), ruled
  2026-11-10:** owner or admin, same gate, validated by
  `lib/clubDetails.ts` for both `/new` and the edit form. **Edits apply
  from the next night; a night in flight keeps its stored
  `scheduled_at`.** "No fixed schedule" isn't offered when editing until
  nights can be scheduled by hand.
  **Roles, ruled 2026-11-11:** only the owner makes or removes admins and
  transfers ownership (`requireOwner`, rules in `lib/roles.ts`); admins
  and members change nobody's role, their own included. One owner per
  club: a transfer goes to an active member through a two-tap confirm and
  leaves the old owner an admin, both changes in one `db.batch` that can
  never leave the club ownerless. `guest` reads as Member.
  **Leaving and removal, ruled 2026-11-11:** anyone may leave, and the
  owner may remove anyone but themself, an admin plain members only
  (`lib/roles.ts` `canRemove`). Both set `left_at` and keep history; the
  seat frees at once and a removed person can be invited again (the
  rotation carries their last pick forward). **An owner leaving hands the
  club on first**, to the same heir as account deletion
  (`lib/clubLeave.ts` `planLeave`, built on `planDeletion`) or one they
  choose, in one batch that can't leave the club ownerless. **The last
  active member can't simply leave**: they pause the club or delete it.
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
  reasoning: the value shown beside the label follows the slider as it
  moves, which a plain form can't do, so it needs local `useState`. Since
  the Tonight redesign (u1, 2026-11-25) it's one slider per score; the
  paired number box is gone. The server action (`submitRating`)
  re-validates the 0–10 range independently; the client component's only
  job is display.
- **`ShareInvite` (`app/clubs/[clubId]/ShareInvite.tsx`) is the third
  justified client component**, after `NominationSelector` and
  `RatingSlider`: the OS share sheet (`navigator.share`) and the
  clipboard only exist in the browser. The invite link is also always
  shown in a read-only field, so nothing depends on either API.
- **`ResendButton` (`app/login/code/ResendButton.tsx`) is the fourth
  justified client component** (u3): only its countdown ticks. The server
  renders it already disabled, with the real wait in words ("Resend
  available in 30 seconds"), from `app/signIn.ts` `resendWaitSeconds`, the
  same rule `issueSignIn` applies, so the two can't disagree; without
  script that render stands until a reload. The server refuses an early
  send whatever the button shows.
- **`TimezoneField` (`app/new/TimezoneField.tsx`) is the fifth justified
  client component** (2026-11-26): only the browser knows the device's
  time zone. It fills an empty field once and never replaces what was
  typed or echoed back; the server validates the zone as before.
- **`CopyCode` (`app/clubs/[clubId]/CopyCode.tsx`) is the sixth justified
  client component** (u5): the clipboard, as for `ShareInvite`. The code
  is always in a read-only field too.
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
  **Foundations (ruled 2026-11-24, approved by Chanho):** besides the
  prototype's palette, a theme sets three semantic tokens, so a theme is
  only a set of values: `--field-line` (a field's or button's edge, at
  least 3:1 against `--bg` and `--card`; `--line` stays for cards and
  dividers), `--focus` (the focus ring, on every control and on a
  `.search` field as a whole) and `--on-accent` (text on an `--accent`
  fill). Late show's `--dim` is #958169 (5.06:1 on `--bg`, 4.70:1 on
  `--card`) and `--field-line` #7a6650 (3.46:1, 3.21:1); the ratios sit
  beside the tokens in `app/globals.css`, and a new theme checks its own.
  Every control is at least a 44px target: `.btn`, tabs, selects and
  fields by their size; a radio or checkbox by its label; a small link or
  text button by `.tap` (an invisible centred `::after`, so it looks the
  same). Links inside a sentence are exempt.
  `app/shell.tsx` holds the shells (`docs/onboarding-spec.md` §5.11,
  Ruling D): **bottom tab bar on phones → top bar at 620px → capped
  content column at 900px → rail at 1120px on club pages**, all via
  `.app`'s `container-type: inline-size` and `@container` queries, not
  viewport media queries. `GlobalShell` wraps every signed-in screen:
  global nav (Clubs, Watchlist, Settings, labels always, `aria-current`
  on the current one) in a fixed bottom tab bar on phones and in a
  sticky top bar from 620px, never a sidebar, with the wordmark top left.
  `PublicShell` wraps signed-out screens (`/` signed out, `/invite`,
  `/login`, `/login/code`, `/verify`, `/welcome`): a slim bar with only
  the wordmark, no global nav. Club pages add `ClubHeader` (name and
  `describeSchedule`'s line, no back chevron) and `ClubTabs`, the
  Tonight · History · Members tab row (sticky: top of the viewport on
  phones, below the top bar from 620px). The tag page marks History
  current, its home (§5.11.2). The watchlist is global, never a club
  page: `/watchlist`, with Watchlist current and no club header, tabs or
  rail. The old `/clubs/[clubId]/list` is only a redirect to
  `/watchlist` (keeping `?q=`), behind the same member gate. **Seen from
  is removed (ruled 2026-11-24, approved by Chanho; reverses
  `docs/onboarding-spec.md` §6.4's Seen from):** no chips, no `?seen=`,
  no `kinomato_seen_from` cookie. Each search badge names its club, one
  per club where it applies ("2 in Saturday Club want this", "Saturday
  Club watched this", `lib/watchlistBadges.ts`), and "Everyone wants
  these" counts a film's overlap in whichever of your clubs has the most.
  A `?seen=` link or a browser still holding the cookie goes once through
  `/watchlist/forget-seen-from`, which deletes the cookie (a page can't)
  and lands on `/watchlist`; it can go after 2027-11-24, when the last
  cookie has expired. `.main` establishes
  its *own* nested container context specifically so `.grid3`'s column
  count responds to `.main`'s actual rendered width, not `.app`'s full
  width — without that, a page with no rail (full-bleed `.main` at
  1120px+) would cram 5 poster columns into whatever width happened to
  be available instead of the width that's actually there.
  **The context rail only ever shows real data, repurposed — never the
  prototype's fake turn-order queue, streaming-expiry list, or
  attendance leaderboard.** The rail is on Tonight and History. On
  Tonight (u1, 2026-11-25) it's This week (the night, voting closes or how
  many are coming, who's picking, who's next), the Members list and the
  last three films the club watched, with a collapsed "This week at a
  glance" in the main column on phones. On History it's the club's
  member list, with the viewer's row marked "(you)" in words plus the
  accent highlight (`app/clubs/[clubId]/memberViews.tsx`), and for owners
  and admins an "Add a person →" link to the invite page. It's absent on
  the Members pages: since u6 (2026-11-27) the Members page lays out its
  own two columns from 900px in a wider main column (`GlobalShell`'s
  `wide`), and its right column (Just for you, Club settings, Leave)
  replaces the rail; the sub-pages are a single column. History and the
  tag page keep the rail or its reserved space (`reserveRail`, a plain
  `aria-hidden` column, not a landmark). Nothing
  about who's in the club or inviting ever depends on a 1120px+ viewport —
  the Members tab has all of it at every width, and most of this club's
  members are on phones. Pages with no
  genuine secondary content pass no `rail` prop at all, rather than
  rendering an empty or fabricated one (`/watchlist` reserves nothing
  either: it has no club tabs to switch between); `.main:only-child`
  in the 1120px query keeps a railless page's content column capped at
  the same width the 900px breakpoint set, instead of stretching
  full-bleed with nothing to balance it against.
- **The "locked" night display (starts/runs/out-by) is a new section,
  not a restyle of an existing one.** Before this, the gap between a
  night locking and the confirmAt threshold clearing rendered nothing at
  all — CLAUDE.md's confirmAt ruling only covers when the "Did you watch
  X?" prompt appears, not what shows before that. This section
  (since u1, the locked hero in `app/clubs/[clubId]/_tonight/WatchStage.tsx`)
  is pure display over the night and its film, plus the result through
  `historyRead.ts`'s `closedTally` — no new write, no new user action,
  and it only ever
  renders in place of the confirm prompt, never alongside it (the
  "one night in flight" invariant guarantees there's only ever one
  candidate night for either section). Its times use the app's one time
  format, `formatNightTime`'s "Sat 8:00pm" (ruled 2026-11-24), as does
  the club header's schedule line ("Saturdays at 8:00pm").
  **"Did you watch X?" names the night it asks about** (ruled
  2026-11-24, `lib/clubStatus.ts` `nightName`): "Saturday night" (or
  morning, afternoon) in the club's timezone while it's within the last
  week, else "Saturday, Nov 7". It used to be a hard-coded "Sunday
  morning".
- **Identity is the session, and nothing else.** One site-wide cookie,
  `kinomato_session` (`app/session.ts`), whose token is stored only as a
  hash; `getIdentityMembershipId` (`app/clubs/[clubId]/identity.ts`) goes
  session → `users.id` → that user's active membership in this club. The
  per-club identity cookie and the name picker are gone; a stale
  `kinomato_identity_*` cookie still in a browser is never read. Pages
  gate with `app/auth.ts`: club routes and `/new` need a session
  (→ `/login?returnTo=<path>`, landing back there after the code), club
  routes also need an active membership, and anyone else gets a **404,
  not a 403** — a 403 would confirm the club exists. Server actions are
  callable directly, so they check again (`requireCurrentMembershipId`).
  **Clearing cookies or a new device is survivable because `users.email`
  is a durable anchor:** a fresh code re-finds the same `users` row, and
  every membership that's that user's is recognized at once. No signing
  library, no unclearable storage.
- **The Tonight redesign (ruled 2026-11-25, approved by Chanho; built in
  u1, `docs/roadmap.md`).** Every stage has the same order: club header
  and tabs, the week bar, **one "do this now" card**, the RSVP card when it
  applies, then everything else. The card's button is the only filled
  (accent) button on the page; everything else is outlined or a text
  link. "Whose turn" is folded into the card's text and the side column.
  - **The week bar:** Nominate → Vote → Locked → Watch → Rate. A draft is
    Nominate, an open night Vote, a locked night before `scheduled_at`
    Locked, from `scheduled_at` until confirmed Watch, and a watched night
    whose ratings are still open Rate. Done steps are ticked, the current
    one is accent-filled with `aria-current="step"`, later ones outlined.
    Phones show a thin five-segment bar and one line ("Step 2 of 5 · Vote
    · then Locked, Watch, Rate"); laptops show the five labelled steps in
    a card. A cancelled or unconfirmed night, a paused club, or no night:
    no bar, the existing message as the card.
  - **Voting:** nominees are poster cards and the whole card is the vote
    button (`aria-pressed`). Your choice has an accent border and "Your
    vote ✓". The page says what the server does: you can change your vote
    until voting closes, and with no votes the picker's first choice wins.
  - **Locked:** the film is the hero (poster, "Locked in", the countdown,
    the title, year, director and "Won 3 to 1"), then starts, runs and out
    by.
  - **RSVP** is its own card under the action, "Coming Saturday?", gone
    from `scheduled_at` (the existing rule).
  - **Rating:** one slider per score, its value beside the label; rating
    comes before any next-night nomination on the page.
  - **Side column** (the rail, from 1120px): This week, Members, and
    Recently watched. On phones, "This week at a glance" is a collapsed
    `<details>` below the cards. No ad slot: it's a private club (the ad
    ruling).
- **Vote counts while voting (ruled 2026-11-25, approved by Chanho).** A
  club setting, "Show vote counts while voting is open"
  (`clubs.settings.showVoteCounts`, boolean, default off), set by owner or
  admin in How this club runs and validated at write time. Off, an open
  night shows no counts; once voting closes the result shows ("Won 3 to
  1"). Display only, so a change applies at once, even to a vote under
  way.
- **"I was there," built (u1, 2026-11-25):** the ruling above, with one
  precision. A night counts as revealed only once a rating is visible:
  every yes-RSVP has rated *and* at least one rating exists. With nobody
  RSVP'd yes and nobody rated, nothing has been shown, so saying "I was
  there" can't un-reveal anything. It records a yes RSVP through its own
  server action, which checks this club's night, watched, not revealed,
  and no "no" RSVP; a stale tab is a silent no-op. After that the person
  rates and is waited on like any yes, and History's "Came:" lists them.
  It never changes the pick.
- **Display name (ruled 2026-11-25, approved by Chanho; built in u2).** It
  reverses "first name + last initial" (Chanho's decision). One
  free-text display name, trimmed, 1–30 characters, unique within each
  club case-insensitively. On a clash when joining or renaming, the
  person is asked to pick another. An invite keeps a name the inviter
  types only to greet the invitee; the invitee chooses their own display
  name when they join.
- **Sign-up and sign-in (ruled 2026-11-25, approved by Chanho; built in
  u3).** Invited sign-up has a three-step bar, Email → Code → About you,
  ending after consent. The invite ("Ana A. invited you to Saturday
  Club") stays in view on every step. The code is six boxes with paste and
  one-time-code autofill, a visible resend countdown and a check-spam
  hint. After sign-up, a welcome page (no bar) to add at least three
  films, skippable. Returning sign-in has no step bar. On laptops, sign-in
  is two columns: what Kinomato is, and the sign-in card. **Built (u3,
  2026-11-26):**
  - **The bar** is `app/stepBar.tsx`, shared with Tonight's week bar.
    It's on the signed-out invite landing (Email) and on `/login/code`
    (Code) when the address's newest code was requested from an invite.
    That's server state, never a URL parameter, and never dependent on
    whether an account exists, which would tell anyone typing an address
    whether it has one. So a named account that signs in through an invite
    sees Email and Code, then skips `/welcome`. On `/welcome` (About you)
    it shows with `?invite=` (an invite id, nothing personal). A returning
    `/login` never shows it.
  - **The code** is one real input (numeric, one-time-code, maxlength 6,
    `\d{6}`, "Your code") drawn over six decorative boxes.
  - **Resend** carries over the invite of the address's newest unused code,
    so an invitee's resend still signs them up. Before u3 it didn't: while
    sign-up was closed they got the invite-only email and no code.
  - **An invited new account** lands on `/clubs/[clubId]/welcome` after
    the name step: three films to add, "Wanted in {club}" from
    `app/watchlistRead.ts` `wantedInClub` (counts only, never names),
    "Go to {club}" filled once three are added, and "Skip for now".
  - **The data-sharing box** reads as one line, with the full current
    wording unchanged under "More about this". Still unticked by default,
    18 or older only, and recorded exactly as before.
- **Own sign-up (ruled 2026-11-25, approved by Chanho; built in u4, live
  only when `OPEN_SIGNUP` is on).** The same three steps plus "Start your
  club": name, day, time, In person or Remote, and every default shown as
  an editable field (how often, films per picker, voting closes, show vote
  counts, when "Did you watch it?" is asked, time zone), with "Joining a
  friend's club instead?" linking to Join. Then a "Get your club going"
  checklist on Tonight (create ✓, invite your people, add at least three
  films to your watchlist, check how the club runs) that disappears when
  done, and an Invite people screen with the bottom tab bar. **Built (u4,
  2026-11-26):**
  - **The flow:** "Start a club" (sign-up open) is `/login/start` (Email)
    → `/login/code` (Code) → `/welcome` (About you) → `/new?start=1` (Your
    club). Its only marker is returnTo `/new?start=1` (`lib/steps.ts`
    `START_CLUB_PATH`), a fixed path, so no new cookie and nothing personal
    in a URL. The bar shows for anyone who enters this way, account or
    not; an account already named goes from Code straight to Your club,
    About you ticked. With sign-up closed, `/login/start` is `/login` and
    no screen shows this bar.
  - **`/new` ("Start your club")** shows every setting, prefilled from the
    readers' own defaults (`lib/newClub.ts` `NEW_CLUB_DEFAULTS`). It's read
    by `readNewClubForm` on the Members tab's own readers
    (`readClubDetailsForm`, `readClubSettingsForm`, `checkFirstNight`), so
    the two never disagree. "No fixed schedule" is offered again (restored
    2026-11-26: u4 dropped it, which was never a ruling); editing still
    can't switch to it (ruled 2026-11-10), and an ad hoc club gets no
    automatic drafts, as before. Every other week or monthly needs a first
    night. **The time zone is prefilled from the device**
    (`Intl.DateTimeFormat().resolvedOptions().timeZone`) when the browser
    lists it, else left empty; it stays required and is validated on the
    server, and without script it's empty (2026-11-26). The "Joining a friend's club instead?" link goes to
    `/join` (u5).
  - **The checklist** (`lib/gettingStarted.ts`) is stored in
    `clubs.settings.gettingStarted` (`{ checked, hidden }`, written at
    creation; malformed fails loud). Clubs from before u4 have none and no
    list. It's for the owner only, while incomplete and not hidden, and is
    always the "do this now" card then, so the week's card below has
    outlined buttons. Invite is done with another active member or a
    pending invite; films at three of the owner's own; Check how it runs
    with "Looks good" or any saved setting or detail.
  - **The invite page** (`/clubs/[clubId]/members/invite`, owner or admin;
    others go back to Members) has the same server rules as before. The
    Members tab's Add a person is a link to it, as are the rails' "Add a
    person →".
- **Club codes (ruled 2026-11-25, approved by Chanho; built in u5).** A
  second way in, beside per-person invites (Chanho's decision). Each
  club may have a short join code, off by default, turned on and
  regenerated by owner or admin; a new code kills the old one. Anyone
  signed in can enter it and "Ask to join". Nobody joins until an owner
  or admin approves, and until then the club sees only the requester's
  display name. The seat cap, and later adults-only gating, apply at
  approval. Private clubs are never searchable; search belongs to public
  genre clubs (`docs/roadmap.md` #28). The approval is the provenance
  record for someone who arrived by code, as `invites.invited_by_membership_id`
  is for an invite ("Every rating is a verified member's"). **Details
  decided 2026-11-26 (approved by Chanho), built (u5):**
  - **The code** (`lib/joinCode.ts`): 8 Crockford base32 characters (no
    I, L, O, U) from crypto randomness, shown XXXX-XXXX, stored without
    the dash in `clubs.join_code` (null = off; `clubs_join_code_idx`
    unique, a collision regenerates). Input ignores case, spaces and
    dashes, and reads I and L as 1 and O as 0, as Crockford does.
  - **Owner or admin, on Members** (until the Members redesign): "Let
    people ask to join with a code" (a submit button with `role="switch"`,
    so no script needed), the code with Copy, and "Make a new code" (the
    old one stops at once). Off nulls the code; pending requests stay
    decidable. Plain members never see the code or requests.
  - **`/join`** (signed in; signed out → `/login?returnTo=/join`, which
    says a code needs an account while sign-up is closed): "Join a
    friend's club", the code, then the club's name only and "Ask to join
    {club}". The code never rides in a URL: the form-echo cookie carries
    it to the confirm step, which shows the name only while that cookie's
    club id and code match the club's current code (so a hand-made cookie
    can't test codes). **Ten wrong codes an hour per person**
    (`join_code_attempts`): each try is recorded before the lookup, so
    simultaneous tries can't share one, and a right code gives its try
    back; a wrong and a switched-off code read the same. At most 5 pending
    requests per person (a plain count, an accepted gap like the seat
    cap); **one pending per person per club is the partial unique index
    `join_requests_one_pending_per_user_per_club`**. A decline shows
    "{club} didn't accept your request." and blocks asking that club for
    30 days. Already in: "You're already in {club}".
  - **Approving** (`app/joinRequests.ts` `approveJoinRequest`): first the
    seat cap **counting pending invites too** (so an approval never takes
    a seat an invite holds), the u2 name clash ("Someone in {club} already
    goes by {name}.", carried by the form-echo cookie, never the URL) and
    "not already in"; any of them leaves the request pending. Then one
    `db.batch`: mark it approved while still pending, and insert the
    membership (`approved_by_membership_id` = the approver) selected from
    *that* approval (this approver, this instant), so a second approver
    or a concurrent decline does nothing. Then "You're in {club}" (one
    link, transactional, never a reminder). Decline: no email. Approvers
    are never emailed. The Members tab shows a count badge to owners and
    admins.
  - **Lifecycle:** only `app/joinRequests.ts` touches `join_requests` and
    `join_code_attempts` (`lib/joinRequestAccess.test.ts`). Export has your
    own requests; account deletion deletes your requests and tries; club
    deletion its requests; leaving or removal neither. Retention: decided
    or cancelled 90 days after the decision, pending after 30 days, tries
    after a day.
- **The Members redesign (ruled 2026-11-27, approved by Chanho; built
  u6).** The sub-pages ruled 2026-11-24, all under the Members tab
  (§5.10): every one has the club header and the tabs with Members
  current.
  - **`/clubs/[clubId]/members`**, in order: "Asking to join" (owner or
    admin, only while someone's asking: initials, display name, "Used the
    club code · {time} ago", "Let them in", the page's one filled button,
    on the first request only, and "Decline"); "People · n of 6" (initials,
    name, "(you)", role in words, "Passed this turn"; a 44px "⋯", labelled
    "Manage {name}", only beside someone `lib/roles.ts` lets the viewer
    act on; "+ Invite" for owners and admins; each pending invite one line,
    "Invited: {name} · not started yet" or "started signing up", to the
    invite page); "Just for you" ("Your limits", "1 never · 1 rather not" or
    "None set", the viewer's own counts only); "Club settings" (owner or
    admin: How this club runs, "Weekly · Sat 8:00pm · 3 films"; Club code,
    "On · XXXX-XXXX" or "Off"; Pause the club, "Running" or "Paused"); and
    "Leave this club", a danger-outlined button to the existing two-tap
    leave. A plain member sees People (no ⋯), Just for you and Leave. From
    900px two columns: Asking and People left; Just for you, Club settings
    and Leave right, in place of the rail.
  - **"Not opened yet" isn't shown:** opening an invite link records
    nothing (link previews open every URL, §7), so the line says what is
    known, whether they've started signing up.
  - **`members/[membershipId]`** (manage a person): a 404 unless the viewer
    may take at least one action on them. Initials, name, "{Role} · joined
    {Mon D}"; a Role card with only the allowed actions ("Make {name} an
    admin", "Remove admin", "Hand the club over to {name}" with its
    confirm); a danger card, "Remove from the club", with its confirm. The
    same actions and server checks; old `?transfer=`/`?remove=` links
    redirect here.
  - **`members/limits`** (anyone, their own only): "Your limits in {club}",
    "Only you see these. Nobody is told why a film is missing.", the limits
    as cards with Remove, then "Add a limit": "How strict?" as two radio
    cards, "About what?" as a three-way segmented radio, the matching
    field, "Add limit"; the "Also on weeks I'm not coming" switch (a submit
    button with `role="switch"`); when a change counts.
  - **`members/settings`** (owner or admin, else 404): "How {club} runs",
    three groups shown as values, each with its own Edit (`?edit=club`,
    `voting` or `after`), which opens that group alone as a form; the
    others stay values. **A group saves only its own fields**: the other
    group's come from what's stored (`lib/clubSettings.ts`
    `groupSettingsFields`), then the usual readers validate. Then the
    club code card and a Pause row → `members/settings/pause`.
  - **Old anchors:** `#limits`, `#club-settings`, `#club-details`,
    `#join-code` and `#add-person` land on their new pages through
    `OldAnchorRedirect` (`app/clubs/[clubId]/members/OldAnchorRedirect.tsx`,
    the seventh justified client component: a hash never reaches the
    server).
  - **The invite page** took over the old list's per-invite actions: "Show
    link" (to share it again) and "New link" (regenerate), beside Cancel.
  - **Wording:** a hard limit is **"Never"** ("Those films never come
    up."), a soft preference **"Rather not"** ("Only a gentle warning."),
    everywhere a person reads them (`lib/constraintForm.ts`
    `LIMIT_KIND_WORDS`; the cap reads "You've used both Nevers. Remove one,
    or choose Rather not."). Internal names (hard/soft, the enum, the
    columns, the export's keys) don't change. The Privacy page's draft
    still says "Limits and preferences"; it's on the lawyer's list.
  - **One new colour, `--danger` #cc6b63** (5.27:1 on `--bg`, 4.89:1 on
    `--card`), for Remove, Leave and Delete only (`.btn.danger`,
    `.card.danger-card`).
- **Onboarding guidance (ruled 2026-11-25).** A step bar exists only
  during sign-up and on Tonight's week. The guided first-time tour
  (`docs/roadmap.md`) stays separate.
- **Invites are per person** (`docs/onboarding-spec.md` §7). An owner or
  admin types their name, a greeting only (`lib/displayName.ts`
  `validateInviteeName`, 1–30 characters), and gets a link for that one person
  (`/invite/[token]`, 128 random bits, stored as-is so it can be
  re-shared), which greets them by name, takes an email, and joins them
  after the code. Pending invites hold a seat (see the free-tier ruling).
  Opening the landing page records and redeems nothing (link previews
  open every URL); `started_at` is set on the first email submitted.
  Redemption (`app/invites.ts`'s `redeemInvite`) claims the invite with a
  conditional update, then inserts the membership, un-claiming if the
  insert fails — neon-http has no transactions. An active member opening
  someone's invite is told they're in and it's left untouched; someone
  signed in as a non-member gets Ruling B's two labelled buttons, never a
  silent redeem. Revoke and regenerate touch one row each (Ruling C),
  owner/admin only, and every invite action re-checks that server-side.
  Redeemed invites are kept: they're the provenance record.

## Things not to do

- Don't port the prototype HTML into React. Rebuild, check against it.
- Don't scrape IMDb for trivia. Derive facts from TMDB fields, or use Wikidata.
- Don't call the Letterboxd API. CSV import of a user's own export only.
- Don't put the TMDB key in a `NEXT_PUBLIC_` variable. Server-side only.
- Don't add third-party trackers, pixels or cookies anywhere, or send
  viewing data to an ad provider (VPPA exposure; the ad ruling).
- Don't fetch streaming availability on browse. Nomination and lock only, 24h TTL.
  Film metadata caches indefinitely; availability does not. One narrow
  exception: certifications are re-checked weekly for about a year after
  release (the age-appropriate films ruling).
- Don't put the SES keys, `AUTH_SECRET` or `SUPPORT_EMAIL` in a `NEXT_PUBLIC_` variable.
- Don't send any email through an SES configuration set (named in the
  request, or attached to the identity as its default: check none is,
  `docs/ses-cutover.md`), or add open or click tracking to any email by
  any other means.
  Server-side only, same as the TMDB token.
- Don't build password reset or social login, or any account page
  beyond Settings (`docs/onboarding-spec.md` §5.9 — exactly what it
  lists, which now includes Download my data and Delete account per
  §11; nothing password-shaped). Auth is email sign-in and nothing
  else. Everything except the marketing page, the invite landing, the
  sign-in flow and the legal pages needs a session; there are no guests
  (§0 explains why).

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
  (`app/new/actions.ts`, `app/clubs/[clubId]/actions.ts`'s invite
  actions), rather
  than throwing. A thrown error in a server action has no error boundary
  to land in anywhere in this app, so the only default is a dev-mode
  overlay or a generic production digest — worse than the "clear
  message" these screens need. Reserve this for validation the user is
  meant to see and correct (a taken name, a cap hit); a genuine bug
  (a failed DB write) should still throw.
- **Pushing schema to `production` is a manual step, and it has a
  direction.** Nothing automates it: CI pushes to its own `e2e` branch
  only, and a merge deploys code without touching the database. Step 2
  shipped without the push, and sign-in broke. For an **additive** change
  to `db/schema.ts` (new table or column, a column made nullable), run
  `DATABASE_URL=<production URL> npx drizzle-kit push` (no `--force`)
  **before** merging, because the new code needs the new columns. For a
  **destructive** change (dropping a column, adding `NOT NULL`), merge the
  code that no longer uses them **first**, then push. The step-4 cutover
  is the one destructive case so far, and `docs/onboarding-spec.md` §8.6
  spells out its order.
- **The schema must round-trip: a second push changes nothing.** Every
  E2E run checks it right after global setup's push, before seeding
  (`e2e/schemaRoundTrip.ts`, drizzle-kit's own diff, never applied), and
  fails with "schema doesn't round-trip: …". Otherwise every production
  push carries noise that buries the change it was meant to make. Two
  drizzle-kit 0.31 limits shape `db/schema.ts`: **multi-column uniqueness
  is `uniqueIndex()`, never `unique()`** (it reads a constraint's columns
  back in no fixed order), and **empty text-array defaults** read back
  as `'{""}'`, so the guard allows exactly the five `SET DEFAULT '{}'`
  lines they produce (`films.genres/directors/cast/keywords`,
  `watchlist_items.tags`) and nothing else.
- **Neon branches, and which is which.**
  - **`production`** backs `dev.kinomato.com` (the Worker's
    `DATABASE_URL` secret). Its data is real clubs.
  - **`e2e`** is CI's (the `E2E_DATABASE_URL` repo secret), and
    **`e2e-local`** is local Playwright's (`.env`'s `E2E_DATABASE_URL`).
    Both are wiped at the start of every run.
  - **`local`** is `.env`'s `DATABASE_URL`, for `npm run dev` and
    `npm run db:seed`.
  - **`.env`'s `DATABASE_URL` must never point at `production`.**
    `db:seed` deletes every row, and `drizzle-kit` reads `.env` by default
    (`drizzle.config.ts`). A schema push to `production` names the URL
    explicitly on the command line, by hand, never through `.env`.
- **Each Neon branch has its own role password.** Passwords are per
  branch; a child branch inherits its parent's password when it's
  created, then they're independent. Rotating one branch's password
  doesn't rotate the others: rotate each one that's exposed, and update
  everything that uses it (`.env`, the `E2E_DATABASE_URL` repo secret,
  the Worker's `DATABASE_URL` secret).
- **Worker secrets: never edit them in the Cloudflare dashboard.** Use
  `wrangler secret put`, and only when the latest uploaded Worker version
  is the deployed one. A dashboard edit deploys the latest uploaded
  version, which may not be `main`: branch builds upload versions too.
  **Non-production branch builds are off** in Workers Builds (Settings →
  Build) since 2026-11-02, so only `main` uploads versions. Don't turn
  them back on without a separate preview Worker and a separate database:
  previews share production's secrets, including its `DATABASE_URL`.
- **Node is pinned to 22** (`.nvmrc`, `engines` in `package.json`), and
  the runtime's timezone data matters. British Columbia is permanent
  UTC−7 from 2026-11-01 (tzdata 2026b): `America/Vancouver` no longer
  falls back. The canary at the end of `lib/schedule.test.ts` fails on
  older timezone data, so stale data in Node (local and CI) is caught by
  the tests. The Worker runs on Cloudflare's runtime, which carries its
  own timezone data and never runs these tests: it was checked by hand on
  2026-11-02 (a Vancouver 6pm night stored as 01:00Z, i.e. UTC−7).
  Re-check it the same way after any future timezone-rule change. DST
  transition tests use `America/Los_Angeles`, which still changes clocks.
- **Never print a connection string or secret in a session.** Parse it
  in-process (e.g. `node`, `dotenv.parse`, the `URL` class) and print only
  derived facts: a hostname, or true/false. Shell filters on raw values
  have failed: a quoted `.env` line slipped past one and leaked a
  password.
- **Design screenshots: `npm run audit:screens`** (`e2e/design/`, ruled
  2026-11-24). Every page in its real states at 375 and 1280, on the E2E
  database through a production build, plus `docs/prototype.html`'s
  screens in each theme and per-page measurements (targets under 44px,
  unlabelled fields, headings, inline styles) in `metrics.json`. Output
  is `design-audit/<AUDIT_LABEL>/` (default `latest`), gitignored: a
  redesign step shoots `before` on `main` and `after` on its branch and
  compares the pairs. Not part of the E2E run (its file isn't a
  `.spec.ts`), and never against anything but `E2E_DATABASE_URL`.
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
  - `e2e/` — 41 spec files, 219 tests (2026-11-19), one or a few per
    feature. It began as one file of six scenarios, and those still run
    in `voting-flow.spec.ts`: identity persists across reload, a vote
    increments its nominee's count, changing a vote moves it rather than
    duplicating (the `db.batch()` path, since neon-http silently having
    no `db.transaction()` is exactly the kind of thing that fails
    quietly), two members in separate browser contexts both voting
    correctly, RSVP persists across reload, and the displayed "Whose
    turn" is checked against `lib/rotation.ts`'s own `getWhoseTurn()`
    output for the same seeded data, so it can't drift out of sync with
    the rotation logic. Two specs run on their own CI-only servers:
    `legal-bump.spec.ts` and `open-signup.spec.ts`.
  - Runs against a **local** server, never `dev.kinomato.com`: `next dev`
    on a developer's machine, `next build && next start` in CI
    (`playwright.config.ts` switches on `CI`). CI tests a production
    build because some bugs only show there — the invite-rotation test
    raced its own server action, hidden by `next dev`'s slower responses
    and exposed every time by a production build. Still not the Workers
    runtime itself; the Workers Builds check covers the bundle building,
    not its runtime behaviour.
  - **Two E2E databases, never one.** `E2E_DATABASE_URL` points at CI's
    own Neon branch in CI (repo secret) and at each developer's own
    branch locally (`e2e-local` in `.env`). Every run starts by dropping
    and recreating the `public` schema, pushing that branch's
    `db/schema.ts` with `drizzle-kit push --force`, then seeding
    (`e2e/global-setup.ts`). A local run and a CI run sharing one branch
    wipe each other mid-run; that produced phantom failures before the
    split. Pushing the schema per run is also why a branch that changes
    the schema can't break another branch's CI. The setup refuses to run
    if `E2E_DATABASE_URL` equals `DATABASE_URL`. `ci.yml`'s concurrency
    group only serializes CI runs against each other.
  - Tests run serially (`workers: 1`) on purpose — they share and
    build on the run's database state, so parallel execution would race.
  - **Sign-in in tests goes through `e2e/session.ts`'s `signInAs`**, which
    inserts a `sessions` row for a seeded membership's account and sets
    the cookie. It's a test helper, never an app route. Tests that are
    about signing in (auth, gating, invites, create-club, first-night) go
    through the real email-and-code flow instead, setting a known code on
    the sign-in row (`e2e/signIn.ts`). Every seeded member is an account,
    named on the account.
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

- **Trusted tier is schema room only.** `users.trusted_at`
  (analysis-v2.md §5.1) exists — non-null would mean trusted, same
  "nullable timestamp as a flag" shape as `paused_at`/`left_at` — but
  nothing sets it and nothing reads it. Trust signals (§5.2: invite
  provenance, account age/cadence, rating variance, cross-club
  presence, device/network clustering) and the weighted-public-ratings
  behavior that would consume this tier are entirely undesigned.
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
- **Vetoes have no UI, no pool-cap enforcement, and no season lifecycle**
  (deferred until seasons are designed, ruled 2026-11-19: see the veto
  ruling).
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
- **Member-level rating preferences.** A club's audience is a club-level
  filter (the age-appropriate films ruling). Whether an individual member
  can also set their own rating preference, and if so whether it's hard or
  soft, isn't ruled on.
- **Postponement duration.** Partly ruled 2026-11-17: passing a turn
  postpones for one night only (the rotation ruling above), and
  `postponed_at` clears when their next night is created, so it can't sit
  forever. Still open: a separate "paused" status for a multi-month
  absence (parental leave, deployment) distinct from missing one week.
- **Veto-exhaustion timing.** If every nominee gets vetoed close to the
  nomination deadline, does the picker get a deadline extension to
  re-nominate, or does the round proceed toward lock with nothing decided?
- **Legal review before any public launch.** The full list of questions
  for the lawyer is in `docs/roadmap.md` ("The lawyer's list"). Three
  distinct areas, none of
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
  must disclose **Amazon Web Services (Canada)** (Amazon SES in
  ca-central-1 since 2026-11-22, replacing Brevo, France: receives every
  account's email address and every email we send, processed in Canada,
  with no open or click tracking), **Neon** (hosts the database), and
  **Cloudflare** (hosts the app, sees every request). **For the lawyer
  (added 2026-11-24):** the Privacy page's cookie list dropped
  `kinomato_seen_from` (Seen from removed) without a Privacy version
  bump, since less is collected; the final text comes with the review.
  **For the lawyer (added 2026-11-22):** whether reminder emails are commercial electronic
  messages under CASL needing express consent, or messages about a
  relationship the person started, and what consent and unsubscribe rules
  follow; and whether 13–17s need different reminder defaults.
  Adding a managed auth provider later means adding a sub-processor
  disclosure — weigh that against the convenience when the time comes.
<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
