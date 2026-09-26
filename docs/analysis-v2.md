# Kinomato — Product Analysis

*Revised after founder review. Changes from v1 are substantial: the revenue model is rebuilt, a second audience is added, and the trust/identity system is new.*

---

## 0. The one decision that drives everything else

You made two calls that look independent but aren't:

- **"Revenue shouldn't come from users."**
- **"We should also target people who live alone — genre clubs, indie film clubs, critique clubs."**

These are the same decision. A private six-person friend club, meeting weekly, generates a handful of sessions per month. Advertising and data licensing against that is worth almost nothing — you'd need on the order of **100,000+ active users** before either line produces meaningful money. A subscription model, by contrast, broke even at roughly 120 paying clubs.

So removing user payment doesn't make the business easier. It **raises the scale you need by two orders of magnitude.** That is not a reason to reverse the call — it's a reason to be clear-eyed that you are now building a scale product rather than a profitable side project.

And the thing that makes that scale reachable is your second call. Private friend clubs cap out at six people and grow one group at a time. **Public genre clubs** — a horror club, a Criterion club, a "bad movies on Sunday" club — have no member ceiling, no scheduling problem, and no attendance requirement. They are the growth engine and the ad inventory. The private friend club is the product's soul; the public club is its business model.

**Strategic framing for everything below: build the private club experience, and let public clubs carry the economics.**

---

## 1. Revenue — rebuilt

### 1.1 What's off the table

- **No member subscriptions.** Agreed. Charging people to join their friend's club kills club formation.
- **No paid themes.** Agreed and conceded — you're right that club identity drives attachment, and attachment is retention. Themes are free, all of them, including custom colors. It's one of the cheapest loyalty features available.
- **No behavioral ad networks.** See §1.5 — this collides badly with minors and with the trust positioning.

### 1.2 Line 1 — Commerce: food, and the timing hook

This is the strongest idea in your list, and the reason is the timing, not the food.

Kinomato knows three things nobody else knows simultaneously: **when the night starts, what the runtime is, and how many people are coming.** That means it can say "order by 7:10 and it lands ten minutes before the opening credits" — and for a long film, "order dessert for the 9:40 break." No delivery app can compute that, because it doesn't know about the movie.

**Implementation reality.** Uber's consumer delivery APIs (cart, order submission, status notifications) exist, but access requires written approval from Uber; the documented and generally available path is merchant-side. DoorDash similarly gates third-party integration behind a certification process with a technical account manager. So:

- **v1:** affiliate deeplinks with a smart pre-filled time. No partnership needed, works immediately, earns a standard affiliate cut. The value is the timing prompt and the group-size math ("6 going — split 3 ways?"), not the integration depth.
- **v2:** apply for consumer API access once there's volume to show. A native cart is a much better experience and a much better rev share.
- **Not recommended:** direct local restaurant advertising. It needs a local sales force. Don't.

### 1.3 Line 2 — Sponsored picks

A distributor with a new release, a boutique label with a restoration, or a streamer with a catalog addition pays to appear as a **suggested nomination** in relevant clubs. A horror club with 400 members is precisely targeted inventory for a horror distributor, and this is native rather than a banner.

Hard rules, because this is the line that can destroy the product:
- Always labeled, always skippable, **never auto-nominated.**
- Only in public clubs. **Never inside a private friend club.** The private club is a sacred space; putting an ad in it is the end of the product.
- Never a paid placement that wins a vote. It's a suggestion, and the group can ignore it.

This is the highest-value ad format available here and the one most likely to survive contact with users.

### 1.4 Line 3 — Rent and buy affiliate

When a picked film isn't streaming anywhere the group subscribes to, the app surfaces rent/buy options with deeplinks. Modest revenue, genuinely useful, zero downside. Treat it as covering the API bill.

### 1.5 Line 4 — Data licensing (and its landmine)

Your instinct is right that the data is valuable. Demand signals — what real groups are adding, nominating, and picking, before it shows up in any viewership chart — is exactly what distributors and streamers pay for, and it's the kind of thing Parrot Analytics and Antenna sell today.

**But this is the single highest-risk line in the plan, and it needs to be built carefully from day one rather than retrofitted.**

The **Video Privacy Protection Act** is a 1988 US federal statute that prohibits a video service provider from knowingly disclosing personally identifiable information about a consumer's viewing. It carries **statutory damages of at least $2,500 per violation**, which has driven a large and accelerating wave of class action litigation against websites and apps that share viewing-related data with third parties through pixels, cookies, and embedded code. Courts have split on key definitions, and the US Supreme Court granted certiorari in *Salazar v. Paramount Global* in January 2026 to resolve who counts as a "consumer" — so the boundaries are actively being redrawn right now. Canadian PIPEDA and BC's PIPA apply to you directly as well, and GDPR applies to any EU members.

**Design consequences, non-negotiable:**

1. **Aggregate only.** License counts, trends, and cohort signals. Never user-level records, never anything joinable back to a person.
2. **Explicit opt-in, separately from the terms of service.** A checkbox at signup that says plainly: *"Include my ratings in anonymous industry trend data."* Default unchecked. This is also your best marketing — being the company that asked is a differentiator.
3. **No third-party tracking pixels anywhere near a film page.** This is what the majority of VPPA suits actually target. It also means no Meta Pixel, no ad-network retargeting — which independently rules out behavioral advertising.
4. **This is a year-three line.** It requires scale and it requires a lawyer. Build the consent architecture now; don't plan revenue from it until there's something to license.

### 1.6 Line 5 — Organizations pay

Libraries, campus film societies, workplace culture clubs, senior centres. They have budgets, they want attendance reporting and public club pages, and they don't blink at ~$120/year. Friends never pay; institutions do. This is the cleanest money in the plan and the easiest to sell.

### 1.7 Line 6 — Club owner pays to grow

Reconciling your point 13 with your point 1: **members never pay. Owners pay to exceed the free ceiling.**

| | Free | Owner upgrade |
|---|---|---|
| Members | up to 6 | unlimited |
| Clubs owned | 1 | unlimited |
| History | full, while active | full |
| Themes | all | all |
| Public club page | no | yes |
| Nomination/lock/vote customization | presets | full control |

Price around $4/month or $30/year, paid by one person who is choosing to grow their club. That's a purchase decision, not a toll gate — nobody is ever blocked from joining a friend's club.

### 1.8 Club owner revenue share — a fork in the road

You asked whether admins should be able to earn. It's possible: a public club owner with a real following takes a share of the sponsored picks and affiliate revenue their club generates.

**Be aware of what this converts you into.** The moment owners earn money, you are a creator platform, not a utility. That brings payouts and tax forms, owners optimizing for engagement rather than good movie nights, disputes over club ownership, and a real content moderation obligation. It's a legitimate strategy — it's how Patreon and Substack grew — but it's a different company than the one in §0.

**Recommendation:** don't build it in v1 or v2. Revisit only if public clubs take off and you see owners doing real curatorial work. Keep the door open in the data model (clubs already have an owner) and closed in the product.

### 1.9 The honest number

Assume roughly $3,000–4,000/year in fixed costs (TMDB commercial licensing at ~$149/month once you monetize, availability data, hosting, email). Against the new model:

- **Organizations** are the only line that meaningfully pays before scale. Roughly 30 institutional customers covers costs.
- **Commerce affiliate** becomes real somewhere around 10,000 active clubs.
- **Sponsored picks** need public clubs with hundreds of members each, and a salesperson.
- **Data** needs scale plus legal budget.

**So: lead with organizations while the consumer side compounds.** That's the bridge, and it's an unglamorous but real answer to "how does this survive year one."

---

## 2. Admin flexibility

Agreed across the board, with one caution: **every setting is a decision you're pushing onto a group of friends, and a support ticket waiting to happen.** Ship presets first, expose the individual toggles behind "advanced."

**Presets:** *Chill* (long deadlines, no penalties, democratic, minimal notifications) / *Standard* / *Serious* (tight deadlines, strict rotation, weighted picker, full reminders).

**Individual settings behind advanced:**

| Setting | Options | Default |
|---|---|---|
| Nomination deadline | 1–7 days before | 3 days |
| Lock time | 1–72h before | 24h |
| Confirmation prompt | morning after / same night / 2 days / manual only / off | morning after |
| Auto-advance if unconfirmed | 24h / 48h / 7 days | 48h |
| Picking method | democratic / picker's choice / weighted picker (1.5× or 2×) / random from nominees | democratic |
| Vote visibility | live / hidden until lock | live |
| Nominees per turn | 1–5 | 3 |
| Veto tokens per person per season | 0–5 | 2 |
| Attendance display | off / streaks only / top attendees | off (private), streaks (public) |
| Cadence | weekly / biweekly / monthly / ad hoc | weekly |

**Vetoes**, distinct from hard limits. A hard limit excludes a film
automatically and costs nothing; a veto is a discretionary call that removes
one nominee from the slate and costs a token from that member's own pool —
per person per season, the same shape as the two-hard-limit cap, never a
pool shared across the club. It does not cancel the round —
the picker is notified and may substitute another film if the nomination
deadline hasn't passed, otherwise voting continues with what's left. If every
nominee on a slate gets vetoed, the picker keeps their turn and nominates
again, same as losing a vote outright: they only ever lose *which* film. No
vetoes after lock. Vetoes are public, with the vetoer named — a visible veto
reads as a boundary, an anonymous one reads as sabotage.

**Notification channel** is a personal setting, not a club setting — it's the individual's phone. Options: push / email / both / none, with a per-club mute. Someone in three clubs must be able to go quiet in one without leaving it.

---

## 3. Roles

Roles are switchable and transferable. Five of them:

- **Owner** — billing, deletion, can transfer ownership. One per club, always transferable. This matters more than it sounds: when a founder loses interest, an untransferable owner role kills the club. Make transfer a two-tap flow.
- **Admin** — settings, membership, can reorder the queue. Multiple allowed.
- **Host** — whoever's place it is this week. Rotates independently of the picker, offset by one so the person choosing isn't also the person cooking. Irrelevant for remote clubs.
- **Picker** — automatic, rotating, not assignable. Can be manually swapped by an admin when someone's away.
- **Member / Guest** — see §5.

A club with no active admin for 60 days should offer the role to the longest-tenured active member. Orphaned clubs are a silent churn source.

---

## 4. Attendance, streaks, and awards

You asked about a loyalty/show-off system. My v1 position was against it; I'll revise it partway rather than reverse it, because the right answer depends on which club type you're in.

**In public clubs: yes, absolutely.** Status is the point. People join a horror club partly to be *known* in it. Streaks, "attended 40 of the last 44," badges, top-attendee boards — all good, all drive exactly the behavior you want.

**In private friend clubs: default off, and never a full ranking.** A six-person friend group has one member with a newborn, one on shift work, one with a long commute. A public list that ends with their name last is a quiet way to make someone feel bad about their life, and they will stop opening the app rather than tell you. If it's on, show **top attendees only** — never a complete ordered list, never a "last place."

**Always safe, in both:** season awards that are about the *films*, not the people. Best pick, worst pick, biggest gap between "good" and "fun," most divisive, longest film anyone sat through. These are the genuinely funny ones and nobody gets ranked.

**Streaks must decay gently.** A broken streak resets quietly. No "you lost your 12-week streak" notification, ever.

---

## 5. Identity, trust, and bot-proof data

This is your best idea in the list and it deserves to be a core architectural principle rather than a feature.

The insight: **Rotten Tomatoes and IMDb have an open-signup problem** — anyone can make an account and brigade a rating. Kinomato doesn't, because of how it grows. Every member arrives through an invite from someone already in a club. That's a traceable provenance chain, and it's a real structural advantage that a public rating site cannot replicate.

### 5.1 Three tiers

*Superseded by `onboarding-spec.md`.*

| Tier | How | Can do | Data counts publicly |
|---|---|---|---|
| **Guest** | Invite link, pick a name | Vote, RSVP, rate within the club | **No** |
| **Member** | Verified email + passkey/password | Everything, plus cross-club watchlist, personal stats, history export, custom avatar, own a club | **Yes** |
| **Trusted** | Member + earned signals | Ratings weighted higher in public aggregates | Yes, weighted |

Account creation is **never required** — a guest can fully participate in their friend's club forever. It's just that their ratings stay local. The upgrade prompt lands at the moment of loss aversion: when they have history worth keeping, or when they want to start their own club.

### 5.2 Trust signals

Beyond email verification:

- **Invite provenance** — invited by a trusted member, from a club with real history. This is the strongest signal and it's free.
- **Account age and cadence** — a real member rates roughly weekly for months.
- **Rating variance** — humans have opinions that vary. Flat or bimodal rating patterns are a bot tell.
- **Cross-club presence** — real people drift between two or three clubs.
- **Device and network clustering** — six "members" from one IP in a brand-new club with no invite chain is a manufactured club.

Ratings enter the public aggregate **only from verified members**, weighted by trust score. A brand-new club can't move a film's public number, which removes the incentive to manufacture one.

### 5.3 Say it out loud

"Every rating on Kinomato comes from a real person who watched the film with people they know." That's a marketing position, a data-licensing pitch, and a genuine differentiator in one sentence. Put it on the site.

---

## 6. Streaming availability — expanded

Availability now appears at **three** points, per your request plus one:

1. **On the watchlist card**, so you know before you nominate whether the group can actually watch it.
2. **On the nomination card during voting**, with each member's own services highlighted. "On Netflix (4 of you have it)" is a much better voting signal than "on Netflix."
3. **At lock**, re-checked. If it's vanished since nomination, the picker is notified and offered the runner-up or a rent option.

Cache with a 24-hour TTL. Never fetch on browse — it's the most expensive call in the product.

---

## 7. Removed and revised

- **Filter-cost indicator: removed**, per your call. Replacement: the picker alone sees a quiet note only when one of their own nominations is blocked — "*Sorcerer* conflicts with a club limit." Nobody else ever sees it, and there's no group-level percentage anywhere.
- **Letterboxd API: dropped**, per your call. One distinction worth keeping: **CSV import is not the same thing.** Letterboxd lets users export their own data, and importing a file a user hands you creates no dependency on a competitor, no API relationship, and no permission to request. It's the single biggest onboarding accelerant available — a new member arrives with 200 films already in their list. Keep the importer, drop the API.
- **Landing pitch: revised.** "Your movie night, organized" was too utilitarian. Warmer directions, in rough order of preference:
  - *"Whose turn is it?"*
  - *"Movie night, minus the arguing."*
  - *"Get everyone back on the couch."*
  - *"Your movie night has a system now. It's still just movie night."*
  
  Note the segments will eventually need different pages — the in-person friend group wants "get the gang together," the solo genre-club viewer wants "find your people and watch something good."

---

## 8. The second audience: solo viewers and public clubs

This is a meaningfully different product sharing the same engine, and it's worth being precise about the differences.

| | Private friend club | Public genre club |
|---|---|---|
| Size | 4–8 | 20–500+ |
| Scheduling | A specific night, a specific place | A window, or fully asynchronous |
| RSVP | Central | Optional or absent |
| Host role | Yes | No |
| Constraints | Individual, respected | Club-level only ("horror club: horror") |
| Rotation | Everyone's turn | Curator picks, or top-voted, or rotating among a moderator pool |
| Discussion | Hot takes after | Threaded, and the main draw |
| Moderation | None needed | **Required** |
| Ads | Never | Sponsored picks, labeled |

The "radio for a genre" framing you described — something on while you eat, in the company of people who like the same stuff — is a real and underserved use case. The key design difference is that **it's asynchronous**: the club picks a film for the week, members watch it whenever, and the discussion opens on a fixed day. Nobody has to be free at 8pm Saturday.

Two things this segment requires that the private product doesn't:
- **Moderation tooling** from day one of the public launch. Report, mute, remove, lock thread. A public club without it becomes someone's problem very quickly.
- **Discovery.** A directory of public clubs by genre and activity level. This is also your SEO surface.

**Build private first.** It's simpler, it's what you'll actually use, and it validates the core engine. Public clubs are v3 — but design the schema for them now, because retrofitting a member ceiling of 500 onto a table built for 8 is unpleasant.

---

## 9. Age and minors

*The "Family clubs" bullet is superseded by `onboarding-spec.md` §0 — dead, not replaced. The rest of this section stands.*

You're right to flag this, and it interacts badly with the ad model.

- **13+ minimum.** No accounts below 13, full stop — under-13 data collection triggers COPPA in the US and equivalent regimes elsewhere, and it is not worth the compliance burden for a product like this.
- **13–17: no personalized or behavioral advertising, ever.** Advertising to minors is separately regulated in most jurisdictions. Sponsored picks that are contextual to the club (a horror film in a horror club) are far safer than anything based on a user profile — which is another independent reason the sponsored-pick model beats an ad network.
- **Family clubs:** the parent owns the club, children participate as guests. Guest data never enters public aggregates anyway, which conveniently means the minors' ratings are already excluded from the data-licensing path.
- **Age-rating ceiling as a club setting.** A family club sets "PG-13 and below" and the constraint engine enforces it like any other hard limit.
- **Don't collect birthdates.** Collect a self-attested age bracket at signup. Less data, less liability.

---

## 10. Data retention and dormancy

Your instinct on decaying inactive data is right on cost and wrong on trust if handled bluntly. Deleting someone's five-year movie club history is a betrayal even if they haven't logged in for a year.

**Recommended policy:**
- Active club: everything retained.
- 6 months inactive: **archived** — read-only, images dropped to thumbnails, availability data purged. Cheap to store, instantly restorable.
- 12 months inactive: email to the owner and all members — "your club is going dormant, here's a full export, reply to keep it."
- 24 months, no response: delete, with one final notice.

Export must be one click and must work on free accounts. An app you can leave is an app people trust enough to stay in.

---

## 11. Revised roadmap

**v0 — your friend group.** Rotation, watchlists, nominations, votes, RSVP, manual confirmation. Guest-only identity. No settings, no notifications. Use it for a month.

**v1 — private clubs, public beta.** Verified accounts and the trust tiers, admin presets, roles with ownership transfer, constraints, notifications with per-person channels, availability at all three points, calendar sync, all themes free, CSV import, rent/buy affiliate.

**v2 — commerce and institutions.** Food ordering with timing, owner upgrade for larger clubs, organization tier with attendance reporting, season awards and recaps.

**v3 — public clubs.** Asynchronous genre clubs, discussion threads, moderation tooling, club discovery, sponsored picks. This is where the business model actually turns on.

**v4 — data, conditionally.** Only with scale, opt-in consent collected since v1, and a lawyer.

---

## 12. Risks, updated

| Risk | Why it's worse now | Response |
|---|---|---|
| Scale requirement | Ad/data revenue needs ~100× the users a subscription would | Organizations bridge year one. Reassess at 12 months. |
| VPPA and privacy exposure | Statutory damages start at $2,500 per violation and litigation is surging | Aggregate-only, opt-in, no third-party pixels. Architected from v1, not retrofitted. |
| Sponsored picks damage trust | The private club is the emotional core | Public clubs only. Never a private club. No exceptions. |
| Public clubs need moderation | Unmoderated public communities fail loudly | Don't launch public until moderation tooling exists. |
| Setting sprawl | Ten toggles is ten arguments in a group chat | Presets first, advanced hidden. |
| Minors plus advertising | Two regulated areas intersecting | 13+, contextual only, no behavioral targeting. |
| Creator payouts convert the company | Owner revenue share changes what you're building | Deferred. Door open in the schema, closed in the product. |

---

## 13. Unchanged from v1 and still true

The kill criterion stands: **if fewer than 40% of private clubs reach week 4, the ritual thesis is wrong** and you should build the decision tool instead. Nothing in this revision changes that test, and it's still the only number that matters in the first six months.
