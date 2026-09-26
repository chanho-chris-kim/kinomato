# Kinomato — Onboarding, Identity & Invites Spec

*The design we build from next. Covers who a person is, how they get in, what
they see before and after, and how the current guest model is torn out.*

---

## 0. What this supersedes, and why

**This spec supersedes `analysis-v2.md` §5.1's three-tier model (Guest /
Member / Trusted).** Two tiers remain: **Member** and **Trusted**. The
Guest tier is gone. §5.2 (trust signals) and §5.3 (the public claim) still
stand, and are stronger for this change (§3 below).

The reason is structural, not cosmetic. A guest identity lives in a cookie,
and a cookie evaporates when someone clears their browser, switches phones,
or opens the club on a laptop. That's tolerable for a product that helps you
pick a film tonight and forgets you tomorrow. It is not tolerable for this
one. Kinomato's value is **persistent history and a fair rotation across
months**: whose turn it is depends on when each person last picked, the
blind reveal depends on knowing who attended, and the history is only worth
keeping if it's attached to the right people. A guest who clears cookies
becomes a stranger with a clean rotation slate. CLAUDE.md already accepts
that as a known hole ("accepted, not solved"). This spec closes it by
removing the thing that makes it possible.

It also reverses or retires these older positions:

| Where | What it said | Status |
|---|---|---|
| `analysis-v1.md` §7.1 | Invited friends vote and RSVP "with no account, no download, no password. Name selection only." Prompt for an account only at loss aversion. | **Reversed.** Every person has an account before they act. The cost is stated in §2. |
| `analysis-v1.md` §1.1 stages 2–3 | "They should have a club before they have a password." Invitee "picks their name, and they're in." | **Reversed.** A founder verifies an email before creating a club; an invitee verifies before joining. (There is still no password, ever.) |
| `analysis-v2.md` §3 | "Member / Guest — see §5." | Guest removed. Roles are Owner, Admin, Host, Picker, Member. |
| `analysis-v2.md` §9 | "Family clubs: the parent owns the club, children participate as guests." | **Dead, not replaced.** With no guest tier and the 13+ account minimum, children under 13 cannot participate at all, and 13–17s need their own email. Under-13 participation is a COPPA question this product is not taking on. Family mode was already out of v1; this spec does not propose a successor. |
| `analysis-v2.md` §11 | v0 "Guest-only identity." | Historical. Describes what v0 was, not what comes next. |
| CLAUDE.md, "Things not to do" | "Don't build … an account settings page." | **Superseded** by the Settings tab (§5.9). That rule was written for a guest-first product where there was no account to have settings. Settings contains exactly what §5.9 lists and nothing password-shaped. |

CLAUDE.md's rulings on identity fallback order, claiming, club-wide invite
tokens, the claim prompt, and the load-bearing reason for the name format
all describe the code *as it is today*. They stay as written until the code
in §8 lands, then get rewritten in the same change. §8.4 lists them.

---

## 1. Decisions (ruled, not open)

1. **No guest tier.** Every person has an account. An account is a verified
   email address and a display name, nothing else.
2. **Auth is email only.** No passwords, no Google, no Apple, no third-party
   identity provider. Apple specifically needs a $99/yr developer membership
   and is deferred until there's an iOS app.
3. **Every sign-in email carries a 6-digit code *and* a link, and the code is
   the primary path.** See §4 for why the link can't be primary.
4. **Watchlists are global per person**, private to that person, surfaced
   per club (§6).
5. **Invite links are per person, not per club.** Each carries who's being
   invited. Delivery is a share button: copy link, or hand off to the OS
   share sheet.
6. **Two public content screens**: the marketing landing page and the invite
   landing page. **Plus** the sign-in flow and the legal pages, which have to
   be reachable signed out (§5.1). Everything else needs a session.
7. **`/` is contextual.** Signed out, it's marketing. Signed in, it's the
   person's own clubs. The signed-in shell has three tabs: **Clubs,
   Watchlist, Settings.**
8. **Hard limits stay on the membership, not the user.** Someone's limits are
   a fact about a room, not a fact about them: the same person may want
   different boundaries in a family club and a horror club. (Ruled, not open.)

---

## 2. The cost we're accepting

`analysis-v1.md` §7.1 called invite acceptance "the single highest-leverage
number in the entire business." This spec puts an email round trip in front
of an invitee's first vote, which is exactly the friction §7.1 was designed
to avoid. The decision is still right, because rotation fairness can't survive
disappearing identities, but the spec owns the cost rather than pretending
it's free:

- **The invite landing page is the compensation.** "Hi Marco — Chris invited
  you to Saturday Club" before anyone types anything turns a sign-up form
  into a personal invitation. The name, the inviter, and the club are all
  on screen before the email field.
- **One field, one code.** No name field on the invite path (the name is
  already known from the invite, and confirmed after verification, §5.6).
  Email in, 6-digit code back, done.
- **Per-person links cost the owner too.** Dropping one link in the group
  chat no longer works; the owner shares one link per friend. The share
  sheet makes each one a two-tap action, but for a six-person club it's
  five shares instead of one. Accepted.
- **Measure it from day one.** Invite acceptance rate = redeemed invites ÷
  (created − revoked). The funnel lives in the `invites` table itself
  (`created_at`, `started_at`, `redeemed_at`, `revoked_at`, §7.1) — a
  first-party query, not an analytics pixel (CLAUDE.md: no third-party
  tracking). If acceptance is bad, this is the number that says so.

---

## 3. Trust and bot resistance

Removing guests **strengthens** `analysis-v2.md` §5.2's argument rather than
weakening it. Under the old model, guest ratings stayed club-local precisely
because a guest was unverifiable. Now:

- **Every rating comes from a verified email.** An email address costs more
  to manufacture than a cookie, and every one has been proven reachable.
- **Every non-founder arrived through a personal invite from an existing
  member.** `invites.invited_by_membership_id` *is* the invite-provenance
  signal §5.2 calls "the strongest signal and it's free." It's now a column,
  not an inference.

**The honest caveat: founders are the open edge.** Anyone can verify an
email on the marketing page, create a club, and invite five email addresses
they control. The provenance chain has an unauthenticated root at every club
founder. What covers that edge is §5.2's rule that already exists: a
brand-new club with no history can't move a film's public number. Trust
weighting, not signup gating, is what makes a manufactured club worthless.

So: **the trusted tier still makes sense; the guest tier doesn't.** Two
tiers:

| Tier | How | Data counts publicly |
|---|---|---|
| **Member** | Verified email, via invite or by founding a club | Yes |
| **Trusted** | Member + earned signals (§5.2) | Yes, weighted higher |

`users.trusted_at` stays schema-room only, same as today. CLAUDE.md's "Guest
ratings stay club-local" ruling becomes moot once this lands: there's no
guest to exclude.

---

## 4. Authentication

### 4.1 The flow

1. Person enters an email.
2. We send **one email** containing a 6-digit code and a link. Same
   credential, two ways to use it.
3. They either type the code into the tab they're already on, or tap the
   link.
4. Verifying finds or creates the `users` row for that email and starts a
   session. There is no separate sign-up: **creating an account is just
   verifying an email for the first time.**
5. If the account has no display name yet, the name step (§5.6) runs once.

### 4.2 Why the code is primary, not a fallback

A link opens wherever the operating system decides, not where the person
started:

- **An installed iOS home-screen app has its own cookie storage, separate
  from Safari.** A link tapped in Mail opens Safari. The session lands in
  Safari's cookie jar, and the installed app never sees it. With link-only
  auth, **a person using the installed app can never sign in to it.** That's
  not an edge case for a product whose notification story is Web Push on an
  installed PWA.
- **Invites arrive in group chats.** Instagram, Messenger, and WhatsApp open
  links in their own in-app browsers. The sign-in link then opens in Safari
  or Chrome, so the person finishes somewhere other than where they started.
  It works, but it's disorienting at the exact moment §2 says friction is
  most expensive.
- **Email security scanners pre-open links.** Outlook Safe Links and
  corporate gateways fetch every URL in an inbound email. A single-use token
  consumed on `GET` is burned before the person ever sees it. (This bites
  today's `/verify` route, which consumes the token on `GET`.)

A code has none of these problems: it's typed into the tab that asked for
it. So the check-your-email screen leads with the code input, and the link
is the convenience for someone reading email on the same device in the same
browser.

**The link stays** for that convenience case, with one change: **`/verify`
never consumes a token on `GET`.** It renders a "Sign in as
marco@example.com" button that `POST`s. A scanner's prefetch sees a page;
only a person's tap signs anyone in.

### 4.3 Code rules

- 6 digits, numeric, `autocomplete="one-time-code"` and
  `inputmode="numeric"` so iOS and Android offer it straight from the
  notification. Paste of a full code into the first box fills all six.
- Same expiry as today's link: **15 minutes.** Code and link share one
  `magic_links` row and expire together; using either consumes both.
- **5 wrong attempts invalidates the code.** A new one has to be requested.
  With a 10⁶ space and 5 tries, a guess succeeds 1 time in 200,000.
- **Stored hashed from the first commit.** The code is new, so there's no
  reason to repeat the plaintext-token gap (CLAUDE.md Open Questions); a
  6-digit code in plaintext is trivially usable by anyone who can read the
  table. The link token should move to the same hashing, which is the Open
  Question's fix.
- **Resend cooldown: 30 seconds.** Per-email send cap: 5 per hour. Brevo's
  free tier is 300/day, and an unthrottled "resend" button is a way to spend
  it on one inbox.
- **No account enumeration.** "We sent a code to that address" is the
  response whether or not an account exists. It always will exist
  afterwards, since verifying creates it.

### 4.4 Sessions

Unchanged from today (`app/session.ts`): a `sessions` row, a 90-day
`kinomato_session` cookie, `users.email` as the durable recovery anchor. New
device or cleared cookies: enter your email, get a code, you're back, with every
club and your whole watchlist, because all of it hangs off `users.id`.

Settings adds **"Sign out everywhere"**, which deletes every `sessions` row
for the user. That matters more while session tokens are stored in
plaintext.

---

## 5. Screens and states

Breakpoints are the existing `.app` container queries (CLAUDE.md theming
ruling), and **navigation is specified in §5.11**, which replaces today's
sidebar model: **< 620px** bottom tab bar, **620px** top bar, **900px**
capped content column, **1120px** context rail on club pages. Every screen
has the wordmark, top left (§5.11.1). Signed-out screens have **no global
nav** at any width. They're the wordmark bar over a single themed card,
centered, the way `/new` and `/join` render today. The marketing page is
the one exception, with a wider two-column layout from 900px.

**Empty states are most of what a new user sees**, so every screen below
lists its empty state first. An empty state always says what to do next,
never just "nothing here."

### 5.1 Route map

| Route | Signed out | Signed in |
|---|---|---|
| `/` | Marketing (§5.2) | Clubs (§5.7) |
| `/invite/[token]` | Invite landing (§5.3) | Invite landing, signed-in variants (§5.3) |
| `/login` | Enter email (§5.4) | Redirect to `returnTo` or `/` |
| `/login/code` | Enter code (§5.5) | Redirect to `returnTo` or `/` |
| `/verify?token=` | Link landing (§5.5) | Link landing (signs in as the link's owner; see §5.5) |
| `/privacy`, `/terms` | Public | Public |
| `/welcome` | → `/login` | Name step, only if no display name (§5.6) |
| `/new` | → `/login?returnTo=/new` | Start a club (§5.8) |
| `/clubs/[id]/…` | → `/login?returnTo=…` | Club, **if an active member**; otherwise **404** |
| `/watchlist` | → `/login?returnTo=…` | Watchlist (§6) |
| `/settings` | → `/login?returnTo=…` | Settings (§5.9) |

- **Non-members get 404, not 403**, on a club URL. A 403 confirms the club
  exists.
- `returnTo` is only ever a same-origin path. Anything else is dropped, not
  followed (open-redirect guard).
- The invite route's Open Graph image (`/invite/[token]/opengraph-image`) is
  public by nature. Group-chat previews fetch it signed out. It shows the club
  name, the inviter's display name, and "invited you." **Never the member
  list**, since the preview is visible to everyone in the chat, not just the
  invitee.

### 5.2 Marketing — `/`, signed out

The pitch, per `analysis-v2.md` §7: *"Whose turn is it?"* A three-step "how
it works" (start a club → add your people → take turns picking), and §5.3's
line, **"Every rating on Kinomato comes from a real person who watched the
film with people they know."** Primary action **Start a club** →
`/login?returnTo=/new`. Secondary **Sign in**. Footer: TMDB attribution,
Privacy, Terms.

- Phone: single column, pitch then actions then steps.
- ≥ 900px: two columns, pitch and actions left, a static illustration of a
  club's Tonight card right.
- At launch this route replaces the static `kinomato-landing` holding page
  (CLAUDE.md Stack). It is the "real marketing page" that ruling anticipates.

There's no separate signed-in route to marketing. A signed-in person who
wants the pitch can sign out.

### 5.3 Invite landing — `/invite/[token]`

The single most important screen in this spec (§2). **`GET` never mutates**:
link-preview crawlers open every URL in a group chat, so opening the page
records nothing and redeems nothing.

| State | What it shows | Action |
|---|---|---|
| **Valid, signed out** (the main path) | "**Hi Marco** — Chris invited you to **Saturday Club**." Under it: cadence and day ("Weekly, Saturdays at 8"), and the next night if one exists. A single email field. Small print: "Not Marco? Ask Chris for your own link." | **Continue** → sends code → §5.5 with the invite carried along. Records `invites.started_at` on first submit. |
| **Valid, signed in, not a member** | Ruling B (§7.4). | |
| **Signed in, already an active member of this club** | "You're already in Saturday Club." The invite is **not** consumed: it's someone else's seat. This is also what an owner sees when they test their own invite link. | **Go to Saturday Club** |
| **Revoked or regenerated** | "This invite link was replaced. Ask Chris for a new one." No club details beyond the name. | None. |
| **Already used** | "Marco's invite has already been used. If you're Marco, sign in." | **Sign in** → `/login?returnTo=/clubs/[id]` |
| **Club full** (6 active members) | "Saturday Club is full right now." | None. The invite isn't consumed, so it works again if a seat opens. |
| **Unknown token** | Same as revoked. Doesn't distinguish "never existed" from "replaced." | None. |

Showing the club name on the revoked and used states is deliberate. The
person already knew it from the link preview, and a message with no context
reads like a phishing page.

Phone: one card. ≥ 620px: the same card, max-width ~440px, centered. No rail,
no nav.

### 5.4 Sign in — `/login`

Heading "Sign in to Kinomato" (or, when arriving from an invite, "Joining
Saturday Club"). One email field, **Send code**.

- **Invalid email**: inline, via the `?error=` redirect convention.
- **Rate-limited**: "We just sent one. Check your inbox, or try again in a
  minute."
- `returnTo` and the invite token (if any) ride along.

### 5.5 Enter code — `/login/code`, and the link landing — `/verify`

**`/login/code`:** "We sent a code to **marco@example.com**." Six boxes,
autofocused. Below: "Or tap the link in the email." Then **Resend** (disabled
for 30s, countdown shown) and **Use a different email**.

| State | Shows |
|---|---|
| Default | Code boxes, autofocus |
| Wrong code | "That code didn't match. 4 tries left." Boxes cleared. |
| Out of attempts | "Too many tries. We'll send a fresh code." **Send new code** |
| Expired | "That code expired." **Send new code** |
| Success | Redirect: name step if needed (§5.6), else invite activation (§7.1 step 6), else `returnTo`, else `/`. |

**`/verify?token=`:** a card reading "Sign in as marco@example.com" with one
button (`POST`). Expired or used token: "This link has expired. Request a new
one," with the email prefilled into `/login`. If this browser is already
signed in as someone else, the button reads "Sign out of Priya S. and sign
in as marco@example.com": explicit, never silent.

### 5.6 Name step — `/welcome` (once per account)

Runs exactly once, the first time an account without a display name signs
in. "What should your club call you?" First name + last initial, validated
by the existing `validateMemberName`.

**Arriving from an invite, it's prefilled** with the name the owner typed
("Marco", "R."). One tap to accept, or edit. (Ruled: the owner's typed
name is a *greeting only*. It addresses the invite and pre-fills this
step, but **the person sets their own name**, and it lives on `users`,
not on each membership.) The first-name-plus-initial
format stays for consistency and so names read the same everywhere, but
**it's no longer load-bearing**: nothing matches people by name anymore,
because claiming is gone. Changeable later in Settings.

### 5.7 Clubs — `/`, signed in

The home screen. A list of club cards for the person's **active**
memberships only. (This replaces today's `/`, which is a security bug:
§8.1.)

| State | Shows |
|---|---|
| **No clubs** (a new founder, or someone whose invite hasn't been redeemed) | "You're not in a club yet." **Start a club** (primary). Below it, quietly: "Waiting to join a friend's club? Ask them for your own invite link, since each link is made for one person." |
| **One or more clubs** | One card per club, **sorted: clubs needing your action first, then by next night, soonest first.** Card contents: Ruling A (§5.7.1). A **Start a club** button sits under the list. |
| **A club you've left** | Not shown. History of a club you've left is out of scope for this spec. |

With exactly one club the list still renders instead of redirecting into the
club. Predictable beats one saved tap, and the card itself carries the answer.

No rail at any width. There's no genuine secondary content here, and
CLAUDE.md's rail ruling is "real data or nothing."

#### 5.7.1 Ruling A — what a club card shows

> **Accepted.** Proposed in the first draft of this spec; ruled as written.

`analysis-v1.md` §2 says the home screen answers three questions at a glance:
*whose turn, what's the plan, am I going.* With several clubs, that answer
has to fit on a card. Each card shows:

1. **Club name**, in the club's display face.
2. **The next night**: "Sat 8:00pm", or "No night scheduled" for `ad_hoc`,
   or "Paused" when `paused_at` is set.
3. **One status line**, chosen by the night's stage and *your* position in
   it. Exactly one line, the most actionable true thing:
   - Your turn to nominate → "**Your turn** — nominate by Thu" *(action)*
   - Voting open, you haven't voted → "Voting — **you haven't voted**" *(action)*
   - Voting open, you have → "Voting — Sam is picking"
   - Locked → "*Thief*, locked in"
   - Confirmable → "**Did you watch *Thief*?**" *(action)*
   - Rating open, you haven't rated → "**Rate *Thief***" *(action)*
   - Otherwise → "Priya picks next"
4. **An accent dot** when the status line is an action for you. That's also
   what floats the card to the top of the list.

Deliberately **not** on the card: member count or free seats (owner business
that belongs on the club's Members page), vote counts (the card is a
doorway, not a scoreboard), anything about attendance (ranked-attendance
ruling), and your RSVP (it's one tap inside and adds a fourth line for the
least important question). **Reasoning:** a card that tries to answer all
three questions becomes a dashboard, and `analysis-v1.md` §2 names density as
a churn risk. One line with an action cue answers the only question that
matters on a list screen: *do I need to go in there?*

### 5.8 Start a club — `/new`

Today's form minus the creator's name, which is known from the account. The
four questions: name, cadence, day and time, in person or remote.
Pre-adding members moves out of this form. After creating, the owner
lands on the club's **first-run state** (§5.10), whose job is getting people
invited.

### 5.9 Settings — `/settings`

**Exactly this, nothing more** (this is the scope that supersedes "no account
settings page"):

- **Your name**: first name + last initial, same validation as §5.6.
- **Email**: shows the current address. **Change** sends a code to the
  *new* address; the change applies only once that code is entered. Until
  then, the old address stays.
- **How we reach you**: push / email / both / nothing (`analysis-v2.md` §2,
  personal not per-club), with a per-club mute list beneath. The two-per-week
  cap line stays as today's prototype copy.
- **Sign out**, and **Sign out everywhere**.
- Footer: Privacy, Terms.

Not here: passwords (none exist), connected accounts (none exist), hard
limits (per club, §5.10), leaving a club (per club, §5.10), data export and
account deletion (§10).

Phone: single column. ≥ 900px: the capped content column. No rail.

### 5.10 Inside a club — `/clubs/[id]`

Three sections, reached by a tab row under the club header: **Tonight ·
History · Members** (Ruling D, §5.11.2, which also places the tabs and
the rail and drops the back chevron). The global
**Clubs** entry stays current inside a club. At ≥ 1120px the rail shows
the club's real member list, as today.

- **Tonight** — the existing night stages (nominate, vote, locked, confirm,
  rate), unchanged by this spec apart from identity. **First-run state**
  (a club with no nights and only its owner): "Add the people you watch
  with," pointing at **Members → Add a person**. It replaces today's "copy the
  invite link" first-run state.
- **History** — unchanged.
- **Members** —
  - **Members**: active members, with role, and "(you)".
  - **Invited**: pending invites (§7), each with its name, how long ago,
    and a status: *Not started* / *Started* (email submitted, not yet
    verified). Owner/admin see **Share**, **Regenerate**, **Revoke** per
    invite.
  - **Add a person** (owner/admin): first name + last initial, **Create
    invite** → the share sheet opens immediately. Seat counter: "4 of 6."
  - **Your limits in this club**: hard limits and soft preferences, per
    membership (ruled, §1.8), with "apply even on weeks I'm out." Moved
    here from the prototype's "You" tab, because they're a fact about this
    room.
  - **How this club runs**: the settings panel, as today.
  - **Leave this club**.

Empty states: **Invited** hides when there are no pending invites. **Your
limits** with none set shows "No limits set for this club" and an add
button.

### 5.11 Navigation

#### 5.11.1 The wordmark (ruled)

**Every screen carries the Kinomato wordmark, top left, linking to `/`.**
Signed out, that's the marketing page. Signed in, it's the club list. That
includes the invite landing, the sign-in flow, the name step, and the legal
pages. The signed-out "single themed card" screens (§5) get a slim bar with
the wordmark above the card; nothing else changes about them.

In the running app the wordmark is missing everywhere, and it's the only
way back out of a club. The rebuild makes it one of two ways out (the other
is the global **Clubs** entry, §5.11.2), but it's the one that works on
every screen, signed in or out, including ones with no nav at all.

The wordmark is text in the club's display face, not an image, so it follows
the theme like everything else (CLAUDE.md theming ruling).

#### 5.11.2 Ruling D — two levels of navigation

> **Accepted.** Proposed in the previous revision of this spec; ruled as written, including the rename of the club-level tab to **Members**.

**The problem.** There are two levels of place in this product, and the
current shell flattens them into one bar:

- **Global**: where you are across the whole app. **Clubs, Watchlist,
  Settings.** Always the same three, whatever you're looking at.
- **Within a club**: where you are inside one club. **Tonight, History,
  Club.** Only exists once you've picked a club, and its contents
  change with which club.

Today's `AppShell` puts **Club** and **Watchlist** side by side in one
sidebar, scoped to a club (`/clubs/[id]/list`). That made sense when a
watchlist belonged to a membership. Now watchlists are global (§6), and the
bar mixes a global destination with a club-scoped one. It also runs a
permanent 186px column at desktop for two links.

**The proposal: global navigation lives at the edge of the screen; club
navigation lives with the club.**

1. **Global level: bottom tab bar on phones, top bar from 620px.**
   - **< 620px:** a slim top bar holds only the wordmark. **Clubs ·
     Watchlist · Settings** sit in a fixed bottom tab bar, where thumbs
     reach and where installed-PWA users expect it.
   - **≥ 620px:** one top bar: wordmark left, then **Clubs** and
     **Watchlist**, then **Settings** at the far right, where web users
     look for account things. Labels always, never icon-only. At 620px,
     a wordmark and three labels fit with room to spare.
   - **No left sidebar at any width.** Three destinations don't earn a
     permanent column. The 620px icon-only state disappears entirely.
     Unlabeled icons are guesswork, and it's the state most tablets
     would have sat in.
2. **Club level: tabs under the club's own header, at every width.**
   Inside a club, the page starts with the club header (name, schedule),
   and directly under it a tab row: **Tonight · History · Members**. It
   looks the same on a phone and on a desktop; only the spacing changes.
   It **sticks to the top of the viewport** (below the top bar at
   ≥ 620px) when scrolling a long Tonight or History page.
   Because it sits under the club's name rather than at the screen edge,
   it reads as *this club's* sections, never as app-wide places. It's the
   same pattern GitHub uses: site header at the top, a repo's own tabs
   under the repo name.
3. **Context rail at ≥ 1120px, club pages only**, as today: real data,
   never fabricated (CLAUDE.md). It shows the member list on **Tonight** and
   **History**, and is **absent on Members**, where it would repeat the
   main column. It sticks below the top bar, so a long History page never
   scrolls it out of view. Clubs, Watchlist and Settings have no rail.

```
Phone (< 620)              Tablet (620–1119)                          Desktop (≥ 1120)
┌──────────────────────┐   ┌──────────────────────────────────────┐   ┌────────────────────────────────────────────────────────┐
│ Kinomato             │   │ Kinomato  Clubs  Watchlist  Settings │   │ Kinomato  Clubs  Watchlist                  Settings   │
├──────────────────────┤   ├──────────────────────────────────────┤   ├────────────────────────────────────┬───────────────────┤
│ Saturday Club        │   │ Saturday Club                        │   │ Saturday Club                      │ Members           │
│ Weekly, Sat at 8     │   │ Weekly, Saturdays at 8               │   │ Weekly, Saturdays at 8             │ CK Chris K.       │
│ [Tonight|Hist.|Memb.]│   │ [Tonight | History | Members]        │   │ [Tonight | History | Members]      │ PS Priya S.       │
│                      │   │                                      │   │                                    │ ...               │
│ (Tonight content)    │   │ (content, capped column)             │   │ (content)                          │                   │
│                      │   │                                      │   │                                    │                   │
├──────────────────────┤   │                                      │   │                                    │                   │
│ Clubs Watchlist Sett.│   │                                      │   │                                    │                   │
└──────────────────────┘   └──────────────────────────────────────┘   └────────────────────────────────────┴───────────────────┘
Phone: top bar scrolls away; club tabs stick to the top; bottom bar is fixed.
Tablet and desktop: top bar and club tabs both stick.
```

**What goes where, and why:**

| Thing | Where | Why |
|---|---|---|
| Wordmark | Top left, every screen | The universal way home (§5.11.1). |
| Clubs · Watchlist | Global bar | Both are about *you*, across clubs. The watchlist is global now (§6). |
| Settings | Global bar, far right at ≥ 620 | Personal (name, email, notifications), not per club. |
| Tonight · History · Members | Under the club header | They only mean anything inside one club. |
| "How this club runs" (club settings) | **Members** tab | It's the club's configuration, not yours. Keeping it out of global Settings avoids two things both called "settings." |
| Your hard limits and preferences | **Members** tab | Ruled per membership (§1.8), a fact about this room. |
| A tag page (`/clubs/[id]/tags/[tag]`) | Club level, **History** tab active | Tags come from ratings, which live in History. It's a view within History, not a fourth tab. |
| Member list at ≥ 1120 | Rail, on Tonight and History | Real secondary content, and the one thing worth glancing at mid-vote. |

**Details the proposal settles:**

- **Active states.** Inside a club, global **Clubs** shows as current.
  You're inside Clubs, one level down. Tapping it returns to the list
  from anywhere, as re-tapping a tab bar does on iOS and Android.
- **No back chevron in the club header.** The wordmark and **Clubs** both
  already go to the list; a third control for the same thing is clutter.
  (This replaces §5.10's "back affordance to the list on phones.")
- **Crossing levels.** A link from inside a club to the watchlist (the
  empty-list state on nominate, §5.10) goes to `/watchlist?seen={clubId}`.
  **Watchlist** shows as current, the club tabs disappear because you've
  left the club level, and **Seen from** is preset to the club you came
  from (§6.4). The watchlist is global, but it remembers why you opened it.
- **No club switcher inside a club.** The **Clubs** list is the switcher.
  Most people are in one or two clubs; a dropdown on the club name would
  be a second way to do what the list already does.
- **Phone chrome budget.** Top bar ~44px (scrolls away), club header
  (scrolls away), club tabs ~40px (sticky), bottom bar ~56px (fixed).
  While scrolling a club page, the fixed chrome is ~96px, about the same as
  the current bottom bar plus the old segmented control. The top bar is
  sticky only from 620px, where vertical space is less scarce.
- **Signed out.** The top bar shows the wordmark and, on the marketing page
  only, **Sign in** at the right. There's no global nav: every destination
  in it needs a session.

**One rename inside this proposal: the club-level "Club" tab becomes
"Members".** With a global **Clubs** in the bottom bar and a club-level
**Club** in the tab row, a phone would show both words on one screen,
meaning different things. "Members" names what most people open it for:
who's in, pending invites, add a person. The owner-facing parts
(how this club runs, leave) sit below that on the same tab. If "Members"
undersells the settings, the fallback is "People". Either is better than a
near-duplicate of a global label.

**Why not the obvious alternatives:**

- *Keep the sidebar, move Watchlist out of it.* That leaves a 186px column
  for three global links at desktop, and still needs somewhere else for
  the club tabs. It's two navigation systems competing for the left edge.
- *Swap the phone bottom bar to club tabs when inside a club.* A tab bar
  that changes its own contents is disorienting, and it's the pattern
  platform guidelines warn against. The bottom bar should be the one thing
  that never changes.
- *Put the club tabs in the sidebar and the global links in the top bar at
  desktop.* It works at 1120px, but then the club level moves between
  phone (under the header) and desktop (side column). Keeping club tabs in
  one place at every width is easier to learn and to build.

**What this changes elsewhere:** CLAUDE.md's theming ruling
describes `AppShell` as "bottom tab bar on phones → icon sidebar at 620px →
labeled sidebar at 900px → optional context rail at 1120px". That becomes
"bottom tab bar on phones → top bar at 620px → capped content column at
900px → rail at 1120px on club pages". It gets rewritten with the rebuild,
alongside the §8.4 list. `docs/prototype.html` already shows this model.

---

## 6. Watchlists: global per person

### 6.1 The model

`watchlist_items` moves from `membership_id` to `user_id`, unique on
`(user_id, film_id)`. One list per person, carried into every club they
join. The Watchlist tab (`/watchlist`) is that list, and nomination in any
club draws from it, filtered by that club's constraints as today.

### 6.2 What "private" means, precisely

**Private means nobody can browse your list as a whole.** There is no
"Marco's list" page anywhere. It does **not** mean invisible to your clubs,
because the club features that make watchlists worth having are disclosures
by design:

- the overlap badge ("3 in your club want this"),
- the "Everyone wants these" smart shelf,
- a film's "who else in the club wants it, and when they added it," plus
  their note (`watchlist-spec.md` §3).

Each of these reveals, one film at a time, that you have that film. And
because the list is global, **it reveals it to every club you're in.** A film
added with the horror club in mind counts toward overlap in the family club,
and shows your name on that film's detail there. That's the accepted
consequence of one list: no per-club hiding in v1. If people want a
film visible to one club and not another, that's a later feature (§10), not a
reason to go back to per-membership lists.

Unchanged: adding or removing a film is never a club-visible event
(CLAUDE.md history ruling). Personal tags on a watchlist item stay personal.

### 6.3 The club-overlap badge

Today (`app/clubs/[clubId]/list/page.tsx:103`) overlap counts
`watchlist_items` joined to *any* membership in the club. **That's a live
bug.** It counts items belonging to members who have left, and a person who
left and rejoined has two memberships whose items both count.

New definition: **the number of distinct `user_id`s among the club's active
memberships (`left_at IS NULL`) whose list contains the film.** This
fixes the bug by construction:

- Leaving a club → your films stop counting there immediately.
- Rejoining → they count again, once. They never left your list.
- One person can't count twice, because the unit is a user, not a
  membership.

### 6.4 The Watchlist tab

| State | Shows |
|---|---|
| **Empty list** (every new account) | "Your list is empty." A search field, focused. Hint: "Try *heat*, or a director." Later: Letterboxd CSV import, which becomes more valuable now that it's once per person, not once per club. |
| **Films, no clubs** | Shelves and header total as today. **No** overlap badges and no "Everyone wants these" shelf. There's no club to overlap with, and an empty badge is worse than none. |
| **Films, one club** | Overlap badges and smart shelves against that club, implicitly. |
| **Films, several clubs** | A chip row, **"Seen from: Saturday Club · Horror Sundays"**, picks which club's overlap the badges and "Everyone wants these" reflect. The choice persists per device. |

The add sheet's "club watched this · week 9" badge follows the same **Seen
from** club.

Phone: the grid3 shelves as today. ≥ 1120px: no rail. The watchlist has no
genuine secondary content (CLAUDE.md).

---

## 7. The invite lifecycle

### 7.1 End to end

1. **Owner (or admin) adds a person.** On Members → Add a person: first name +
   last initial. Refused if the club's **active members + pending invites**
   already total 6. (Ruled: pending invites hold a seat,
   so "4 of 6" means what it says.)
2. **An invite is created.** New `invites` table:

   ```
   invites  id, club_id, token, invitee_name,
            invited_by_membership_id, created_at,
            started_at, redeemed_at, redeemed_by_user_id, revoked_at
   ```

   The token is 128 random bits. The URL is
   `https://kinomato.com/invite/{token}`. It carries no club id, so the link
   doesn't leak the club's permanent URL.

   **Stored as-is, unlike the sign-in code (§4.3).** The owner has to be able
   to share the same link again days later ("can you resend that?"), and a
   hashed token can't be shown twice. The exposure is smaller than a
   session's. Anyone who can read the `invites` table can already read the
   club it would admit them to. And a stolen invite can only ever produce
   one new, visible member that the owner can remove, whereas a stolen
   session silently *is* someone.
3. **The owner shares it.** One **Share** button. Where `navigator.share`
   exists (every phone, most desktop browsers), it opens the OS share sheet
   with the text *"Hi Marco — join Saturday Club on Kinomato"* plus the URL.
   Where it doesn't, the button is **Copy link**. A just-created invite opens
   the share sheet immediately. **Share** on a pending row re-shares the same
   link any time later.
4. **The invitee opens it.** Invite landing, §5.3. Nothing is recorded on
   `GET`.
5. **Account.** They enter an email → `started_at` set on first submit →
   code → verified. A new email creates the `users` row. An existing one signs
   them in.
6. **Membership activates.** In order, never as one silent step:
   - **Claim the invite:** a conditional update that sets `redeemed_at` and
     `redeemed_by_user_id` `WHERE redeemed_at IS NULL AND revoked_at IS NULL`.
     No row updated → the invite was used or revoked in the meantime → show
     that state (§5.3).
   - **Re-check the cap:** active members only, per CLAUDE.md's
     cap-at-join ruling.
   - **Insert the membership:** `club_id`, `user_id`, role `member`. A
     partial unique index on `(club_id, user_id) WHERE left_at IS NULL`
     makes a second active membership a rejected insert, the same shape as
     the "one night in flight" index.
   - If the person previously left this club, rotation carry-forward matches
     their prior membership by `user_id` (§8.2). Rejoining still doesn't jump
     the queue.

   neon-http has no transactions, so this is claim-then-insert with the
   invite claim as the gate. If the membership insert fails after a
   successful claim, un-claim the invite so the link still works.
7. **Name step** if the account has no name (§5.6), prefilled from
   `invitee_name`.
8. **Land on the club's Tonight**, with a one-time "You're in, Marco" note.

**"First redeemer binds"** (ruled): an invite
belongs to whoever verifies an email through it first. The link is a bearer
credential, and anyone who can see it can use it. The landing page's "Not
Marco?" line, the used-invite state, and individual revoke (§7.3) are the
mitigations. There's no mismatch check against Marco's email, because the
owner never gives one. Asking owners for five email addresses up front is
heavier than the problem it prevents.

**No time expiry.** An unredeemed invite works until it's redeemed or
revoked. The control is revoke, which is instant. A 7-day expiry would mostly
punish the friend who opens the group chat late.

**Redeemed invites are kept, not deleted.** They're the provenance record
(§3).

### 7.2 Removing someone who already joined

Not an invite operation. That's member removal on the Members list, and it
sets `left_at` as leaving does today. Revoke only ever applies to an
unredeemed invite.

### 7.3 Ruling C — revoking one person's invite

> **Accepted.** Proposed in the first draft of this spec; ruled as written.

**Yes: an owner or admin can revoke or regenerate one person's invite
individually, without touching anyone else's.**

- **Revoke** sets `revoked_at`. The link shows the "replaced" state on its
  next open, and the seat frees immediately.
- **Regenerate** is revoke + a new `invites` row with the same
  `invitee_name`, and it opens the share sheet. Marco's old link dies;
  Priya's and Sam's don't change.
- Owner/admin only, the same restriction as today's club-wide rotation
  (CLAUDE.md invite-token ruling): both change who can get into the room.
- Only unredeemed invites show these actions.

**Reasoning:** per-person links make this nearly free. Each invite is its own
row, so revoking one is a single-row update with no blast radius. Under the
old club-wide token, stopping one leaked link meant rotating everyone's.
Individual revoke is also the main mitigation for "first redeemer binds"
(§7.1). If Marco's link got forwarded, the owner kills that one link and
sends a new one. "I sent it to the wrong chat" is a regenerate. (It's not
the fix for "I can't find the message" — that's a re-share, §7.1 step 3.)
Without individual revoke, an owner who sent a link to the wrong place has no
fix except waiting to see who shows up.

### 7.4 Ruling B — invite opened while signed in as someone else

> **Accepted.** Proposed in the first draft of this spec; ruled as written.

The case: an invite made for Marco is opened in a browser already signed in
as **Priya S.**, who is not an active member of that club. (If she *is* a
member, it's the "already in" state, §5.3, and nothing is consumed.)

**Show both identities, never redeem silently, and make the safe choice the
primary one:**

> **This invite is for Marco.**
> You're signed in as Priya S.
>
> **[ Sign out and continue as Marco ]** ← primary
> Join Saturday Club as Priya S. instead
> *(Marco will need a new link from Chris.)*

**Reasoning.** The two realistic causes are (1) a shared device, where Marco
opens his link on a partner's laptop, and (2) a person with a second account,
or someone the link was forwarded to. Redeeming as Priya is not blocked:
under "first redeemer binds," a signed-out Priya could redeem it anyway by
typing her email, so a block here protects nothing. But the **cost of the
two mistakes is lopsided.** Wrongly signing Priya out costs her a code
entry. Wrongly redeeming as Priya takes Marco's seat and forces the owner to
regenerate. So the primary button protects the invitee named on the link,
the secondary one is still honest about what it does, and neither happens
without a tap.

---

## 8. Migration from the current model

**All current data is test data. Nothing is preserved.** No data migration
code is written. The schema changes, the Neon branches are wiped, and
`db/seed.ts` is rewritten for the new shape. This section is about *code and
concepts* being removed, not rows being moved.

### 8.1 Fix first, separately: `/` lists every club in the database

`app/page.tsx` runs `select().from(clubs)` with no filter and links every
row. **This is a bug, not a design choice.** Any visitor to `dev.kinomato.com`
can see every club's name and walk into its page. It was dev scaffolding
(CLAUDE.md calls it "the dev club-listing page"), and it's reachable on a
deployed URL that real friends use.

It ships **before and independently of** the rest of this spec, as its own
small change: signed out, `/` shows a plain holding message and a sign-in
link. Signed in, it lists only the clubs where the session's user has an
active membership. The rest of this spec then replaces that stopgap with
§5.2 and §5.7.

A related hole closes in §8.2: the per-club identity cookie is trusted
as-is (`app/clubs/[clubId]/identity.ts` returns its value without checking
it against anything), so whoever holds a membership id can act as that
member.

### 8.2 What happens to each piece

| Today | After |
|---|---|
| **`kinomato_identity_{clubId}` cookie** (per-club guest identity, checked first) | **Removed.** `getIdentityMembershipId` becomes session → `(club_id, user_id)` active membership, nothing else. Stale cookies still sitting in browsers are simply never read. |
| **Name picker** on `/clubs/[id]/join` (`claimExistingName`, `joinAsNewMember`) | **Removed**, with the whole `/clubs/[id]/join` route. Replaced by `/invite/[token]`. |
| **Claim flow** (`ClaimPrompt.tsx`, `magic_links.claim_membership_id`, the claim branch in `/verify`) | **Removed entirely.** There is no unclaimed membership to claim: every membership is created with a `user_id`. |
| **`memberships.identity_key`** | **Dropped.** It existed to be "the user's id where there is one, otherwise a per-club token." There is always a user id now, so it collapses to `user_id`. Rotation carry-forward on rejoin matches prior memberships by `(club_id, user_id)`. The rotation `ORDER BY` itself is unchanged. The "guest who clears cookies can't be matched" caveat disappears. |
| **`memberships.user_id`** nullable | **`NOT NULL`**, plus the partial unique index from §7.1. |
| **`memberships.display_name`** | **Dropped.** Name lives on `users.display_name` (nullable only until the name step). Reads join through. |
| **`clubs.invite_token`** (club-wide, rotatable) | **Dropped.** Replaced by the `invites` table (§7.1). `requireValidInviteToken` and the rotate action go with it. |
| **`magic_links`** | Loses `claim_membership_id`. Gains `code_hash`, `attempts`, and an optional `invite_id`. `returnToClubId` becomes a general same-origin `return_to` path. |
| **`watchlist_items.membership_id`** | Becomes **`user_id`**; unique on `(user_id, film_id)`. |
| **`constraints.membership_id`** | **Unchanged**: ruled (§1.8). |
| **`votes`, `vetoes`, `rsvps`, `ratings`, `nominations`** | Unchanged. Still keyed to membership, which is still the right unit: a vote is cast by a person *in a club*. |

### 8.3 Tests

- **E2E** leans on the name picker throughout: every scenario picks an
  identity by clicking a name. All of that is rewritten. **One** spec runs
  the real flow end to end (invite → email → code read from the E2E
  database, as `auth.spec.ts` already does with link tokens → name step →
  club). Every other spec starts from a **test-only fixture that inserts a
  `sessions` row straight into the E2E database** and sets the cookie. It's
  a test helper, never an app route. There's no dev-only backdoor, the same
  posture `auth.spec.ts` takes today.
- `e2e/first-night.spec.ts` stays the proof that a club reaches its first
  night with zero hand-seeding. It now starts at the marketing page instead
  of `/new`.
- **Unit tests first** (CLAUDE.md convention) for the pure parts: code
  generation and attempt-limit logic, invite state resolution (valid /
  revoked / used / full / already-member / signed-in-as-other → which
  screen), and the new overlap definition.

### 8.4 CLAUDE.md rulings to rewrite when the code lands

Leave these as written until then. They describe the running code:

- "Identity resolves in a fixed fallback order: per-club cookie, then
  session, then nothing."
- "Claiming updates the existing membership row in place."
- "Invite links carry a token; a club id alone no longer admits a joiner."
- "A name is first name + last initial, always" (keep the format, drop the
  claim-by-name justification).
- "Rotation is computed, never stored": the `identity_key` sentences only.
  The ordering stands.
- "Guest ratings stay club-local": becomes moot.
- "A club with no nights renders a distinct first-run state": its invite-link
  pointer changes to "Add a person."
- Things not to do: "Don't build … an account settings page" (superseded by
  §5.9), and "a guest can fully participate forever without ever seeing a
  prompt that blocks anything" (reversed).
- Open Questions: "Multi-club membership has no UI" (resolved by §5.7) and
  "Claim-race edge case" (moot).
- "Theming is one attribute, not a rewrite": its `AppShell` breakpoint
  description, per Ruling D (§5.11.2).

### 8.5 Build order

1. §8.1's `/` fix, alone, now.
2. Code-primary auth (§4): code + link in one email, `POST`-only `/verify`,
   hashed code, attempt limits. Tests first.
3. Schema + seed rewrite (§8.2), then the E2E fixture (§8.3).
4. Invites (§7) and the invite landing page (§5.3).
5. Routing and shell: contextual `/`, the wordmark and the navigation
   model (§5.11), auth gating, 404 for non-members (§5.1).
6. Global watchlist and the overlap fix (§6).
7. Settings (§5.9).

---

## 9. Privacy and processors

Email-only auth is a privacy choice as much as a simplicity one: no password
hashes exist to breach, and no identity provider (Google, Apple, Auth0,
Clerk) sees who signs in to what. **It does not mean no processors.** The
data-flow section of the privacy policy lists, at minimum:

- **Brevo** (Sendinblue SAS, France) — receives every account's email
  address and every sign-in email. A sub-processor, with a cross-border
  transfer out of Canada.
- **Neon** — hosts the database, which is all of it.
- **Cloudflare** — hosts the app and sees every request.

TMDB receives no personal data. Calls are server-side and carry no user
information.

Two known gaps this spec does not close (CLAUDE.md Open Questions):
**session and magic-link tokens are stored in plaintext**. The fix is
hashing, and this spec's new sign-in code is built hashed from the start.
(Invite tokens are deliberately not hashed: §7.1 step 2.) And **adding any managed auth provider later means a new sub-processor
disclosure**, which has to be weighed against the convenience when the time
comes.

---

## 10. Out of scope, open

- **Per-club watchlist visibility** — hiding a film from one club but not
  another (§6.2). Not built. Revisit only if people ask.
- **Data export and account deletion.** `analysis-v2.md` §10 wants one-click
  export on free accounts, and PIPEDA likely requires a deletion path. Both
  belong with the legal review, not this spec. Leaving a club and
  anonymization are the existing `analysis-v1.md` §1.3 ruling.
- **A leaver's view of past club history.** A club you've left disappears
  from `/` (§5.7). Whether you can still read its history isn't decided.
- **Two members with the same display name in one club.** It can now happen
  (two "Chris K."s), and nothing breaks because identity is by user, but it's
  confusing. Not handled. Revisit if it happens.
