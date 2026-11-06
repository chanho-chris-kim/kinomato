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
- `docs/onboarding-spec.md` — **the rebuild.** No guest tier, email
  code + link sign-in, per-person invites, global watchlists, the public/
  signed-in route split, two-level navigation. Supersedes analysis-v2.md
  §5.1's three tiers and reverses analysis-v1.md §7.1's no-account invite
  loop. Build order is its §8.5; steps 1–5 are built (the cutover
  removed guests; step 5 was the shell, navigation, History and the
  marketing page), step 6 (global watchlist, split 6a–6e) is in
  progress, and 7 (settings) is next.
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
- Auth: email sign-in via Brevo (`lib/email.ts`, `BREVO_API_KEY`,
  falls back to a console-logged code and link when unset — same shape
  as `TMDB_READ_TOKEN`). One email carries a 6-digit code and a link;
  **the code is the primary path** (`/login` → `/login/code`), because
  it's typed into the tab that asked for it, and a link can't reach an
  installed iOS app's separate cookie jar. `/verify` never signs in on
  `GET`: email scanners pre-open links, so only its button does.
  `app/signIn.ts` issues and completes both. No credential is stored in
  the clear (`lib/authCredentials.ts`): session and link tokens as
  SHA-256, the code as an HMAC keyed by `AUTH_SECRET` (a bare hash of a
  6-digit code is cracked in milliseconds). 5 wrong codes kill that
  code; sends are limited to one per 30s and 5 an hour per address.
  `AUTH_SECRET` falls back to a fixed dev value outside production and
  **throws in production when unset** — set it as a Worker secret. No
  passwords, no social login. See `docs/onboarding-spec.md` §4 and the
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
separate planned step: lock (`/clubs/[clubId]`'s "Lock it in"), club
creation and invites (`/new`, then per-person invites), and first-night
(`lib/schedule.ts` plus the lazy draft-night creation on `/clubs/[clubId]`
page load — see the ruling below). A club created today reaches its
first nomination with zero hand-seeding: `e2e/first-night.spec.ts` is
the proof, running the whole loop — create, invite, join, watchlist,
nominate, vote, lock, confirm, rate — on data the test itself creates.
v0 is feature-complete; what's left is the Open Questions below.

The purpose of v0 is to find out which rulings below are wrong.

**Next: the onboarding rebuild.** The build order is
`docs/onboarding-spec.md` §8.5: seven sessions, each shippable on its own,
with `main` deployable between them. Step 4 (the cutover) wipes
`dev.kinomato.com`'s data and follows the written checklist in §8.6,
not improvisation.

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
  migration problem.
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
  `lib/schedule.ts`'s `getNextOccurrence`; `lib/clubStatus.ts`'s
  `getDraftToCreate` decides. The signed-in `/` calls the same function
  to show a club's next night and whose turn it is, **for display only**:
  only the club page ever inserts the row. The "one night in flight" index turns
  a race between two simultaneous page loads into a rejected insert on
  the loser, caught and re-read rather than thrown — same shape as
  confirmNight and lockNight losing a race to each other. `ad_hoc`
  clubs can't lazy-create (no standing day/time to compute from) and get
  their own explicit "no night scheduled" state, not a broken-looking
  blank one — and there's no UI yet to schedule one for them manually.
- **"Whose turn" names who the club is waiting on: the in-flight night's
  picker.** When a club has a `draft`, `open` or `locked` night, the
  heading shows that night's picker. Only with no night in flight does
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
  itself resolves (watched, cancelled, or unconfirmed).
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
  number — not derived yet: week numbers wait until seasons have a
  defined start and length, and History omits them until then — picker,
  state including `cancelled` and `unconfirmed`), the final
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
  reminder to omit it: **`app/clubs/[clubId]/historyRead.ts`** (built in
  rebuild step 5f). It is the only code that reads the votes and vetoes
  tables, and nothing it returns carries a `membership_id` from them:
  `liveVotes` (an open night's counts plus *your own* vote, pre-lock
  only — Tonight's tally), `viewerVotedOnOpenNights` (the club cards on
  `/`), `votesForLock` (nomination ids for `lockNightCore`'s tally) and
  `clubHistory` (finished nights' final counts and a veto count, never
  voters or vetoers). **Enforced by a test:** `lib/attributionAccess.test.ts`
  scans `app/` and `lib/` and fails, naming this ruling, if any other file
  imports `votes` or `vetoes` from `db/schema`, reaches them through a
  namespace import, or names them in SQL. The one exception is the
  club's server actions (`app/clubs/[clubId]/actions.ts`), which import
  them to *write* (cast or move a vote, cast a veto) and may never read
  them.
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
  picker and `openVoting`'s server check). **Enforced by a test:**
  `lib/watchlistAccess.test.ts` fails, naming this ruling, if any file
  other than the loader and the own-list files
  (`app/clubs/[clubId]/list/page.tsx` and `actions.ts`, which touch only
  the viewer's own rows) touches `watchlist_items`. **Per-club lists or
  folders** (§6.2's later feature, §10) are planned, not built: they add
  one table, loaded by `app/watchlistRead.ts` into `ClubVisibilityRules`
  and applied in `visibleToClub`, with no call site changing. A film
  detail's "who else wants it" (`whoElseWants`) is a named slot in the
  loader, to build when that panel exists. Adding or removing a film is
  still never a club-visible event (history ruling).
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
  necessarily watch. This is a different mechanic from analysis-v1.md's
  "spoilers for absent members" (blurred until *you* mark yourself as
  having watched it) — that one protects someone who missed the night,
  this one protects the group's honesty while everyone's still rating.
  Both can be true at once; only this one is built in v0.
- **Two pushes per week per member, across all their clubs — not per club.**
  Plus one extra on their picking week. Notifications dedup across clubs someone
  belongs to. Everything else is in-app. This is a product constraint, not a
  setting.
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
- **A name is first name + last initial, always — never a single free-
  text field.** It lives on the account (`users.display_name`), one per
  person, the same in every club — memberships carry no name. Set once at
  the name step (`/welcome`), composed by `lib/memberName.ts`'s
  `validateMemberName`/`composeDisplayName` (first name non-empty, last
  initial exactly one letter, both trimmed, the initial uppercased), the
  same validation wherever a name is typed: the name step and an owner
  adding someone to invite. The owner's typed name is a greeting and the
  name step's prefill, nothing more — the person sets their own. The
  format is consistency, no longer load-bearing: nothing matches people
  by name since claiming is gone. Pages read names through
  `app/clubs/[clubId]/members.ts` (`nameOf`); an account that hasn't been
  through `/welcome` yet shows as "Unnamed member". No email and no full
  last name are ever shown to a club.
- **A new club gets a distinct first-run prompt, not a generic empty
  state.** On Tonight (`/clubs/[clubId]`), while the owner is the only
  member and no night has ever finished, an owner or admin sees "Add the
  people you watch with." with a link to the Members tab's Add a person
  form (`/clubs/[clubId]/members#add-person`). "No nights at all" can't be
  the test: the first page load lazily creates the owner's draft night
  (the lazy-creation ruling above). A club with nobody active to pick
  still gets its own "No night scheduled yet" state, pointing at the
  Members tab; anything else with no night in flight gets the generic
  "No open vote right now".
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
- **`ShareInvite` (`app/clubs/[clubId]/ShareInvite.tsx`) is the third
  justified client component**, after `NominationSelector` and
  `RatingSlider`: the OS share sheet (`navigator.share`) and the
  clipboard only exist in the browser. The invite link is also always
  shown in a read-only field, so nothing depends on either API.
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
  phones, below the top bar from 620px). The watchlist page shows the
  club header without tabs, being a different level, and the tag page
  marks History current, its home (§5.11.2). `.main` establishes
  its *own* nested container context specifically so `.grid3`'s column
  count responds to `.main`'s actual rendered width, not `.app`'s full
  width — without that, a page with no rail (full-bleed `.main` at
  1120px+) would cram 5 poster columns into whatever width happened to
  be available instead of the width that's actually there.
  **The context rail only ever shows real data, repurposed — never the
  prototype's fake turn-order queue, streaming-expiry list, or
  attendance leaderboard.** The rail is on Tonight and History: the club's
  member list, with the viewer's row marked "(you)" in words plus the
  accent highlight (`app/clubs/[clubId]/memberViews.tsx`), and for owners
  and admins an "Add a person →" link to the Members tab's form. It's
  absent on the Members tab, where it would repeat the main column, but
  its space is kept, empty (`GlobalShell`'s `reserveRail`, a plain
  `aria-hidden` column, not a landmark), so switching between the tabs
  never moves or resizes the main column. The tag page shows the club
  tabs too, so it reserves the same space. Nothing
  about who's in the club or inviting ever depends on a 1120px+ viewport —
  the Members tab has all of it at every width, and most of this club's
  members are on phones. Pages with no
  genuine secondary content pass no `rail` prop at all, rather than
  rendering an empty or fabricated one (the watchlist reserves nothing
  either: it has no club tabs to switch between); `.main:only-child`
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
- **Invites are per person** (`docs/onboarding-spec.md` §7). An owner or
  admin adds "First R." and gets a link for that one person
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
- Don't add third-party tracking pixels anywhere near a film page (VPPA exposure).
- Don't fetch streaming availability on browse. Nomination and lock only, 24h TTL.
  Film metadata caches indefinitely; availability does not.
- Don't put the Brevo key or `AUTH_SECRET` in a `NEXT_PUBLIC_` variable.
  Server-side only, same as the TMDB token.
- Don't build password reset or social login, or any account page
  beyond Settings (`docs/onboarding-spec.md` §5.9 — exactly what it
  lists, nothing password-shaped). Auth is email sign-in and nothing
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
    displayed "Whose turn" is checked against `lib/rotation.ts`'s own
    `getWhoseTurn()` output for the same seeded data — not a hardcoded
    expectation, so it can't drift out of sync with the rotation logic.
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

Things that aren't ruled on yet. Don't guess at these — ask, or flag them here
and move on.

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
<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
