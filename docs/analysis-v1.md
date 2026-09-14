# Kinomato — Product Analysis v1 (superseded)

*Archived. Superseded by analysis-v2.md, but still the source for the flow rulings in §1. Prepared as a cross-functional review — product, design, engineering, data/partnerships, market, revenue, growth, legal, and corporate development.*

---

## 0. The thesis, in one paragraph

Every competitor in this space is building a **decision tool**: "we're on the couch right now, help us pick something in 60 seconds." That product gets opened once, solves the problem, and gets deleted. What we are building is a **ritual tool**: a club with a rotation, a history, a scoreboard, and a standing appointment. The decision is a feature of the club, not the product. This distinction determines the entire strategy — it's why our retention curve should look nothing like a swipe app's, why we price per club instead of per seat, and why our growth loop is invitations rather than app store discovery.

The risk that follows from the same thesis: rituals die. Most friend groups that start a weekly movie night stop by week six. Our real product problem is not picking movies. It is **keeping a group's habit alive after enthusiasm fades.** Everything in this document should be read against that.

---

## 1. Product & UX — the end-to-end flow

### 1.1 The journey, stage by stage

**Stage 1 — Arrival.** Someone in the group chat gets tired of the argument and lands on the site. They are not looking for a movie app; they are looking to stop negotiating. The landing page has to say "your movie night, organized" and not "discover films."

**Stage 2 — Create the club.** Name, cadence (weekly / biweekly / monthly), day and time, and in-person or remote. Four questions, one screen. Notably absent: account creation. They should have a club before they have a password.

**Stage 3 — Invite.** A link and nothing else. The invitee taps, sees the club already populated with the founder's name and the first scheduled night, picks their name, and they're in. Account creation happens later, when they'd lose something by not having one. **Invite friction is the single highest-leverage number in the entire business** — see §7.

**Stage 4 — The founding draft.** The empty-club problem is severe: five people, no watchlists, nothing to vote on. Rather than an empty state, week one is a **draft**. Everyone adds five films before the club unlocks. It's a game, it takes four minutes, and it produces exactly the raw material the system needs. Clubs that skip the draft should be expected to die early.

**Stage 5 — The nomination.** The rotation says whose turn it is. That person picks two or three films *from their own list* and the nomination window opens. Deadline is automatic (48h before the night).

**Stage 6 — RSVP.** Everyone marks going / not going. This is not just attendance — it feeds the constraint engine (§1.2). RSVP must be one tap from a push notification, with no app open required.

**Stage 7 — The vote.** One tap per person, movable until lock. Live counts visible. The nominator votes too.

**Stage 8 — Lock.** 24 hours before the night, everything freezes: the winner is set, availability is re-checked, and the calendar event updates with the title. Lock is a real moment in the product, and it needs to be, because it is what makes the plan trustworthy.

**Stage 9 — The night.** The app's job here is to shut up. One screen: title, time, place, who's coming, one deeplink to the streaming service.

**Stage 10 — Confirmation and logging.** The next morning: "Did you watch Thief?" Three options: yes / no / we watched something else. Anyone can answer; first answer wins. Then ratings and one-line takes.

**Stage 11 — The advance.** Turn moves to the next person. Loop closes.

### 1.2 The hard problem: constraints and RSVP

This is the most interesting design problem in the product and also the most socially delicate, so it gets its own section.

**The failure mode.** If every member can register standing restrictions — no horror, no subtitles, nothing over two hours, nothing sad — the eligible catalog collapses to almost nothing, and no one can see why. Six reasonable preferences compound into an impossible filter. Worse, nobody feels responsible, because each individual constraint was modest.

**The fix, in four parts:**

1. **Separate hard limits from soft preferences.** A hard limit is content someone genuinely cannot watch — it is never overridden and never voted on. A soft preference is a dislike; it appears as a warning on the film card ("Dana would rather not") and as a tiebreaker, but it never blocks. Most people, given the distinction honestly, will classify only one thing as hard.

2. **Cap hard limits at two per person.** Scarcity forces honesty. It also gives everyone the same budget, so no single person becomes "the difficult one."

3. **Show the cost of the filter to the whole group, not to the person.** A quiet line on the nomination screen: *"Your club's limits currently exclude about 34% of films."* This makes the tradeoff legible without assigning blame. It rises when someone adds a limit, and people self-regulate.

4. **Constraints scope to attendance.** Limits apply to members who RSVP'd yes. If the horror-averse member isn't coming this week, horror is eligible.

**The trap inside part 4.** This is a genuinely dangerous mechanic and needs handling with care. Scoping constraints to attendance creates two bad incentives: a group can quietly learn that "we get better options when Dana's out," and Dana can log in and see that the week she missed was the horror week. That's a friendship problem the app created.

Mitigations, all of which matter:
- **Never surface the causality.** The UI never says "horror unlocked because Dana is away." The pool just is what it is.
- **Let members opt to have their limits always apply,** even in absentia — some people don't want the club watching things they'd have to skip, for spoiler or FOMO reasons. Default off, one toggle.
- **Never show attendance as a leaderboard.** Attendance streaks as a private, positive stat are fine. A public ranking of who shows up least will end friendships and should not be built.

**The RSVP-flip problem.** Dana RSVPs no, horror wins, then Dana can come after all. Rule: after lock, RSVP changes do not re-run the filter. Dana gets a plain message — this week is *Sorcerer*, no pressure either way — and the pick stands. Re-deciding after lock destroys the trustworthiness of the lock, which is worth more than any individual night.

### 1.3 Other conflicts, and the rulings

| Conflict | Ruling |
|---|---|
| Picker's film loses the vote | Can't happen — all nominees are theirs. They lose *which* film, never their turn. |
| Night gets cancelled | A cancelled night does not consume a turn. Picker keeps it. |
| Nobody confirms whether it happened | Auto-advance after 48h, but flagged **unconfirmed** in history. Never silently advance as if confirmed — history integrity is what makes the rotation trustworthy. |
| Someone misses their turn (travel, illness) | Pushed to the front of next week, not skipped. Visible in the queue as "postponed." |
| Availability drift — film leaves Netflix between nomination and lock | Re-check at lock. If it's gone, notify the picker and offer runner-up or rent-instead. |
| Spoilers for absent members | Hot takes and ratings blurred until you mark yourself as having watched it. |
| One person does everything | Visible participation, but never scored or ranked. Nudge the quiet ones privately ("your list is looking thin"), never publicly. |
| Club goes dormant | After two missed nights, tone shifts from reminder to offramp: "want to pause the season?" A pause button is a retention feature; nagging is a churn feature. |
| Member leaves the club | History preserved, their picks remain in the record. On explicit request, anonymize rather than delete — deleting rewrites everyone else's memories. |
| Someone belongs to three clubs | Notifications de-duplicate across clubs; hard weekly cap applies per person, not per club. |

### 1.4 The notification budget

Notifications are how this category of app kills itself. The rule is a **hard cap of two pushes per week per member**, plus one extra for whoever's picking:

- **Push:** "Vote closes tomorrow" and "Tonight at 8." That's it.
- **Push (picker only):** "Your turn — nominate by Thursday."
- **Email:** weekly digest, season recap.
- **In-app only:** everything else. New nominations, ratings coming in, someone joined, someone changed their RSVP.

Quiet hours enforced by the member's timezone. Every notification carries an action so it can be resolved from the lock screen.

---

## 2. Design

Three theme directions were developed: **Rep house** (repertory cinema programme — cream, ink, one red accent, serif display), **Late show** (dark, amber marquee, warm), and **Video rental** (deep teal, magenta, chunky yellow — playful). The recommendation is to ship Late show as default, offer Rep house and Video rental as club-selectable themes, and make theme choice a paid feature later. Theme identity is unusually valuable here because a club is an identity — groups will want their club to look like *theirs*.

Design principles specific to this product:
- **The home screen answers three questions in one glance:** whose turn, what's the plan, am I going.
- **Density is a churn risk.** Push watchlists and history to their own tabs. A fun app that looks like a dashboard stops being fun.
- **No badges, no streaks that punish.** Streaks that break are shame mechanics; a broken streak should quietly reset, not accuse.

---

## 3. Engineering

### 3.1 Stack

- **Next.js (App Router)** on Vercel — server actions cover most mutations, no separate API layer needed at this scale.
- **Postgres** (Neon or Supabase). Relational is unambiguously right here: the rotation, votes, and constraints are all joins.
- **Drizzle** for schema and migrations.
- **Auth:** magic link via Resend, plus guest sessions keyed to an invite token. Guests can vote and RSVP with no account; they're prompted to claim their identity once they have history worth keeping.
- **Realtime:** not needed v1. Six people voting over 48 hours does not require websockets — poll on focus. Add Supabase Realtime only if live-room voting becomes a feature.
- **Push:** Web Push (VAPID) with email fallback. Skip native apps entirely for v1; PWA install prompt is sufficient.
- **Scheduled jobs:** Vercel Cron for the lock job, reminders, auto-advance, and availability re-checks. These jobs are the actual backbone of the product — treat them as first-class, with logging and replay.

### 3.2 Data model

```
clubs            id, name, cadence, default_day, default_time, timezone,
                 mode (in_person|remote), theme, created_at
memberships      id, club_id, user_id, display_name, joined_at,
                 left_at, role
users            id, email, avatar, created_at
films            id, tmdb_id, title, year, runtime, poster_path,
                 genres[], cached_at
watchlist_items  id, membership_id, film_id, added_at, note
constraints      id, membership_id, kind (hard|soft), rule_type
                 (genre|keyword|runtime|rating|language), value,
                 applies_when_absent (bool)
nights           id, club_id, scheduled_at, host_membership_id,
                 picker_membership_id, state (draft|open|locked|
                 watched|cancelled|unconfirmed), winning_film_id,
                 locked_at, confirmed_at, confirmed_by
nominations      id, night_id, film_id, membership_id
votes            id, nomination_id, membership_id, created_at
rsvps            id, night_id, membership_id, status, updated_at
vetoes           id, night_id, nomination_id, membership_id, season_id
ratings          id, night_id, membership_id, score_quality,
                 score_fun, hot_take, created_at
seasons          id, club_id, started_at, ended_at
```

**Rotation is computed, not stored.** `ORDER BY last_picked_at ASC NULLS FIRST` over active memberships, with postponements as an override column. Storing a pointer means every skip, join, leave, and pause becomes a migration problem; computing it means those are all just queries.

**Constraint evaluation** runs at nomination time and again at lock, against the set of yes-RSVPs. Cache the resulting eligible-genre set on the night row so the UI doesn't recompute per request.

### 3.3 Build phases

**v0 — your friend group (2–3 weekends).** Clubs, memberships, watchlists, rotation, nominations, votes, RSVP, manual confirmation. No constraints, no notifications, no auth beyond a shared link. Ship it and use it for a month. The point of v0 is to find out which of the rulings in §1.3 are wrong.

**v1 — public beta (4–6 weeks).** Magic-link auth, constraint engine, web push, calendar sync, TMDB integration, streaming availability, themes, season history.

**v2 — monetization (4 weeks).** Club subscriptions, season recaps, Letterboxd import, larger clubs, stats.

**v3 — distribution.** Discord bot, Trakt sync, Plex/Jellyfin, native shells if the PWA proves limiting.

---

## 4. Data & partnerships (the licensing reality)

This section contains the single biggest hidden cost in the plan, so read it before pricing anything.

**TMDB** is the right metadata source — deep catalog, good images, 39 languages. It is free for non-commercial use with attribution. **The moment the product earns revenue in any form, it is commercial**, and TMDB's own staff have quoted **$149/month** as the applicable commercial plan for a small paid app. That is roughly $1,800/year of fixed cost that lands *before* the first subscriber. Note also that TMDB's terms prohibit using their content in connection with training AI/ML applications — relevant if "AI suggests your next pick" is ever on the roadmap.

**Streaming availability** — Watchmode offers a developer tier with 2,500 free monthly requests for non-commercial use, and covers 54 countries; JustWatch operates a commercial data partnership program. Availability data is the most expensive thing per-request in the product, so cache aggressively (24h TTL is fine — catalogs don't change hourly) and only fetch on nomination and lock, never on browse.

**Letterboxd import** is the highest-value integration and the least available. Letterboxd's API is request-only; access requires emailing them with your intended use, and they explicitly do not guarantee access or individual replies. Third-party libraries that scrape public RSS feeds exist and work for basic diary and list data, but are fragile and not a foundation to build a paid feature on. **Recommendation:** apply for API access early — the application itself costs nothing and the lead time is unknown — and ship CSV import (Letterboxd exports natively) as the reliable path in the meantime.

**Trakt** has an open API and is the pragmatic sync partner for watch history.

**Plex / Jellyfin** matter to a small but extremely loyal segment who host their own libraries. Low priority, high goodwill.

---

## 5. Market

### 5.1 The problem is well-documented

The decision-fatigue statistics are unusually strong for a consumer pitch. Research reported in 2026 found that 29% of Americans spend more than 30 minutes deciding what to watch, and 30% said choosing took longer than watching — rising to 46% among Gen Z and Millennials. A separate UserTesting survey put it at roughly 110 hours per year per person. Around 21% of viewers abandon the session without watching anything.

Use these numbers carefully. They justify the *category*, not our product — a swipe app addresses the same statistic. Our pitch layers on top: the decision is worse in groups, and groups that formalize it stop having the problem entirely.

### 5.2 Segments

| Segment | Size | Fit | Notes |
|---|---|---|---|
| Recurring friend clubs (5–8 people, 20s–30s) | Core | Excellent | Already coordinating in a group chat. This is who the product is for. |
| Long-distance friends & family | Smaller | **Best retention** | The ritual *is* the relationship. Highest willingness to pay, lowest churn. Underserved. |
| Couples | Very large | Mediocre | Rotation is trivial with two people. They want a decision tool, which is a crowded market. Good acquisition, poor retention. |
| Roommates / families | Large | Good | Family mode needs age-rating constraints. |
| Campus film societies, libraries, workplace culture clubs | Small, monetizable | Good | The quiet B2B wedge. Letterboxd already runs org accounts, so precedent exists. |

**Strategic call:** market to couples if you must for volume, but *build* for long-distance groups. They're the ones who'll still be here in year two.

### 5.3 Competitors

| Who | What they do | Why we differ |
|---|---|---|
| **Letterboxd** | 30M+ members as of July 2026, film logging and social diary; acquired by Tiny in 2023 for a reported ~$50M; launched a rental Video Store in Dec 2025. Pro $19/yr, Patron $49/yr. | The gorilla. Superb at logging, has no group decision or scheduling layer at all. Our biggest competitive risk is that they ship one. |
| **Picaflick** | Shared watchlists, common-title merging, Letterboxd/IMDb import, Plex sync, API | Closest overall competitor. Still list-shaped, not calendar-shaped. No rotation, no attendance, no night. |
| **VoteFlix, NightPick, MiruList** | Room-based group voting, shareable links, no-account guests, some with a spin-the-wheel tiebreak | Session-shaped. Room dies when the night ends. No memory, no turns, no history. |
| **CineMatch, Swyf, Stream Vote, Movie Night** | Swipe-to-match on a filtered catalog | Tinder mechanic. Fun once. Nothing brings you back next Saturday. |
| **GroupPick** | Collaborative watchlists with AI suggestions and group ratings | List management, not event management. |
| **Teleparty, Scener, Plex Watch Together** | Synchronized remote playback | Adjacent, not competing. Natural integration partners for remote clubs. |
| **A group chat and a shared note** | Free, universal, zero setup | **The actual competitor.** Any feature that's harder than sending a text loses. |

**The honest summary:** this is a crowded category of shallow products. Nobody has built the club layer. That gap is real, but it exists partly because the club layer is harder to build and slower to grow than a swipe app — which is a reason to build it, not a reason to assume no one has thought of it.

---

## 6. Revenue

**Principles first:**

- **No ads.** The product is a small trusted space between friends. Ads will destroy it, and the CPMs on a weekly-use app are pitiful anyway.
- **Never per-seat.** If joining a friend's club costs money, the club never forms. Per-seat pricing is how this business dies.
- **One person pays for the group.** There is always one organizer. Charge them, and give them something that visibly benefits everyone.
- **Never sell viewing data.** Non-negotiable, and worth saying out loud on the pricing page.

**The model:**

| Tier | Price | Contents |
|---|---|---|
| Free | $0 | Up to 6 members, one club, full rotation and voting, 3-month history |
| Club | ~$4/mo or $30/yr, **paid by one member** | Unlimited members, full history, all themes, season recaps and awards, Letterboxd/CSV import, calendar sync, custom club URL |
| Organization | ~$120/yr | Libraries, campuses, workplaces. Multiple clubs, admin roles, public club pages, attendance export |

**Secondary:** affiliate revenue on rent/buy deeplinks. Real but small — treat it as covering the API bill, not as a business line.

**Unit economics sanity check.** With TMDB commercial at ~$1,800/yr plus availability data, hosting, and email, fixed costs are roughly $3,000–4,000/year before any support time. At $30/club/year that's **~120 paying clubs to break even.** That's an achievable number, and it should reframe expectations: this is a plausible profitable small product, not an obviously venture-scale one. Letterboxd's ~$50M outcome shows the ceiling exists, but it took twelve years and 30 million members to get there.

---

## 7. Growth & marketing

### 7.1 The one loop that matters

Every club creation is an invitation to five people. That is the entire growth engine, and its efficiency is set by one number: **what fraction of invited friends actually join.** Everything else is secondary.

Consequences for the product:
- Invited friends must be able to vote and RSVP **with no account, no download, no password.** Name selection only.
- The invite link preview must render the actual club — name, night, members already in — not a generic marketing card. Group chats are where this link lives, so the OG image is a growth surface.
- Prompt for account creation only at the moment of loss aversion: when they have a watchlist and history worth keeping.

### 7.2 Shareable artifacts

- **Season recap.** The Spotify Wrapped play, and it fits this product unusually well: films watched, total runtime, best pick, worst pick, the biggest gap between "good" and "fun," most reliable attendee. Exported as an image. Once a season, timed for December.
- **The rating gap itself.** "We rated *Point Break* a 6.2 for quality and a 9.1 for fun" is a screenshot people post unprompted. Make it a first-class shareable card.
- **Club pages.** Optional public page for a club's history. Free SEO, free social proof, zero effort.

### 7.3 Channels

- **Reddit** — r/movies, r/flicks, r/Letterboxd, r/badMovies. Post as someone who built a thing for their friends, because that's true. Do not post as a startup.
- **Film TikTok / film Twitter** — the season recap is the content, not the app.
- **Campus film societies and public libraries** — direct outreach, small numbers, high conversion, and they pay.
- **Product Hunt / Hacker News** — one shot each, best spent at v2 with the recap feature live.

### 7.4 Retention

The retention feature is **the calendar event.** Once movie night is a recurring entry in six calendars, the app stops competing for attention and starts being infrastructure. Push calendar sync hard and early.

Second: **the pause button.** Groups take breaks. An app that lets a club pause gracefully in August gets it back in September. An app that keeps sending "you missed movie night" notifications gets uninstalled in August.

**Measure the right thing.** DAU is meaningless for a weekly product and will make you build the wrong features to chase it. The metrics are: invite acceptance rate, **percentage of clubs still active at week 4, 12, and 26**, and nights-confirmed per club per month.

---

## 8. Legal & trust

- **Attribution is mandatory.** TMDB requires their logo and a specific notice stating the product uses TMDB but is not endorsed or certified by them. Non-negotiable and easy.
- **Data minimization.** Store the least possible. Watch history is intimate. This should be a stated principle on the marketing site, not a buried policy.
- **Minors.** If family mode ships, that's COPPA/age-gating territory. Keep it out of v1 rather than half-doing it.
- **Never host or stream content.** Deeplink out, always. The moment there's a player, the legal profile changes completely.
- **Group content moderation.** Private clubs, so the risk is low, but public club pages need a report path before they launch.

---

## 9. Risks and kill criteria

| Risk | Severity | Response |
|---|---|---|
| Ritual thesis is wrong — groups don't sustain | **Highest** | Kill criterion: if fewer than 40% of clubs reach week 4, the premise is broken. Pivot to the decision tool. |
| Letterboxd ships group nights | High | They're slow and focused on logging, but they have 30M members. Move fast; be acquirable rather than competitive. |
| TMDB commercial cost lands before revenue | Medium | Delay monetization until the fixed cost is covered, or negotiate. Budget for it explicitly. |
| Notification fatigue drives uninstalls | Medium | The two-per-week cap is a product constraint, not a setting. |
| Constraint system creates social friction | Medium | The mitigations in §1.2 are load-bearing. Watch for clubs where a member goes quiet after adding a limit. |
| Solo-founder bandwidth | High | Scope v0 to three weekends. If it isn't usable by your own friends in a month, the plan is too big. |

---

## 10. Exit and partnership

**Most natural acquirer: Letterboxd (Tiny).** They own the film-logging identity layer and have no group ritual layer. A product with tens of thousands of active clubs and clean weekly engagement is a coherent tuck-in for them. Tiny is a holding company that buys profitable small internet businesses and leaves them alone, which is a genuinely good outcome for a product like this.

**Others:** Trakt (natural feature merge), JustWatch (they want engagement surfaces above their data), Plex (already courting the group-viewing use case), Fandango or Roku (further afield, more about audience than product).

**Integration partners before acquirers:** Discord is the highest-value one and the most underrated. Enormous numbers of friend groups already live in a Discord server. A bot with `/nominate`, `/vote`, and `/rsvp` is lower friction than any app can ever be, and it's a distribution channel rather than just a feature.

**Realistic expectation.** The likeliest good outcome is a self-sustaining product with a few thousand paying clubs, run by one or two people. Plan for that. Build it so an acquisition is possible without needing one to be worth the effort.

---

## 11. What to do first

1. Build v0 for your own six people. No constraints, no notifications, no auth.
2. Use it for four consecutive weeks and write down every time someone works around the app.
3. Apply for Letterboxd API access now — the queue is unknown and the application is free.
4. Build the constraint engine only after you've seen your own group need it.
5. Ship the season recap before you ship payments. It's the growth engine and it's the thing people will pay for.
