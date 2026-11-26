# Kinomato roadmap

The order things get built in. **Status:** done, next (being built now, or
the next thing to start), or later. Rulings live in `CLAUDE.md` and the
specs; this file only says what comes when and why. Update the status when
a step ships, in the same branch. Recorded 2026-11-24 (approved by Chanho).

## Ops, alongside the build

| Item | Status | Purpose |
|---|---|---|
| SES cutover (`docs/ses-cutover.md`) | done (2026-11-23) | Email goes out through Amazon SES in Canada. Production sign-in email sent through SES ca-central-1; Gmail showed SPF, DKIM and DMARC passing and no tracking pixel. The `BREVO_API_KEY` secret is deleted, Brevo's DNS records are removed, and `_dmarc` reports go to Chanho. Closing the Brevo account itself stays under launch switches (#17). |

## Now

| # | Item | Status | Purpose |
|---|---|---|---|
| 1 | d0 foundations | done (2026-11-24, #51) | Contrast, focus, 44px targets, semantic tokens, one time format, Seen from removed, and `npm run audit:screens` to compare every redesign step. |
| u1 | Redesign: Tonight | next | The week at a glance: a week bar (Nominate → Vote → Locked → Watch → Rate), one "do this now" card, poster-card voting with "Your vote ✓", the locked film as the hero, one slider per score, "I was there" until the reveal, and the "Show vote counts while voting is open" setting (ruled 2026-11-25). |
| u2 | Display name | later | One free-text display name (1–30 characters, unique within each club, case-insensitively) replaces first name + last initial; the invitee picks theirs on joining (ruled 2026-11-25). |
| u3 | Sign-up and sign-in | later | Invited sign-up as three steps (Email → Code → About you) with the invite always in view, six code boxes with paste and autofill, a resend countdown, then a welcome page to add three films; returning sign-in with no step bar; two columns on laptops. |
| u4 | Own sign-up | later | Live only when `OPEN_SIGNUP` is on: the same three steps plus "Start your club" with every default shown and editable, then a "Get your club going" checklist on Tonight and an Invite people screen. |
| u5 | Club codes | later | A second way in beside per-person invites: an optional short code, off by default; "Ask to join", approved by an owner or admin. Private clubs are never searchable. |
| 3 | Redesign: Members | later | People first; Your limits, How this club runs, and Leave/Pause move to their own pages under the Members tab (ruled 2026-11-24). |
| 4 | Redesign: Settings | later | A menu of rows that open pages on phones; menu and panel side by side on wide screens. |
| 5 | Wide-screen layouts | later | Real multi-column layouts at laptop widths, not a phone column stretched. |
| 6 | One contextual ad slot, designed in | later | A place for an ad designed into global pages (the Clubs list, Watchlist), never into a private club's pages, within the ad rulings. Empty until contextual ads ship. |

## Before public launch

| # | Item | Status | Purpose |
|---|---|---|---|
| 7 | a1 Rating data | later | Store each film's CA and US certifications (`film_certifications`) and its derived level (all ages, teen, adult, or unknown). No behaviour change. |
| 8 | a2 Backfill and refresh | later | Rate the films already cached, and re-check unrated ones weekly for about a year after release, a few per run of the hourly job. |
| 9 | a3 Audience setting and the all-ages filter | later | Clubs choose All ages (13+) or Adults only (18+); all-ages clubs nominate, vote on and lock teen-or-below films only. Existing clubs migrated. |
| 10 | a4 Adults-only gating | later | 13–17s can't join an adults-only club (invites, joining, the name and consent steps), and a club with a 13–17 member can't switch to it. |
| 11 | a5 13–17 watchlists | later | 13–17s search and add teen-or-below films only, and can self-attest up to 18+ in Settings. |
| 12 | a6 Cleanup | later | Drop `films.certification` and `lib/ageCeiling.ts` (destructive, last). |
| 13 | Guided first-time tour | later | A new member learns the weekly loop on their first visit, not by trial and error. |
| 14 | Redesign: Watchlist and History | later | Club badges collapsed into one line per film; History easier to scan as it grows. |
| 15 | Contextual ads | later | The first live ads, contextual and privacy-safe only, outside private clubs (CLAUDE.md ad ruling). |
| 16 | Lawyer review and final legal text | later | The reviewed Terms and Privacy replace the drafts (a version bump); everything on the lawyer's list below answered. |
| 17 | Launch switches | later | `OPEN_SIGNUP` on; `APP_ORIGIN` → `https://kinomato.com` (with the domain move in CLAUDE.md Stack); drop `users.avatar` and the unused `guest` value of `membership_role`; close the Brevo account. |

## After launch

| # | Item | Status | Purpose |
|---|---|---|---|
| 18 | Animations | later | Motion that explains what changed, always respecting `prefers-reduced-motion`. |
| 19 | Per-club themes | later | Owner or admin picks Late show, Rep house or Video rental for their club (ruled 2026-11-24). |
| 20 | Choosing which clubs see which films | later | When adding a film, choose one club, several, or all (default all), through the visibility seam. |
| 21 | Language limits | later | Hard limits and preferences on a film's original language (ISO 639-1). |
| 22 | Letterboxd CSV import | later | Bring an existing watchlist in from a person's own Letterboxd export. Never the Letterboxd API. |
| 23 | Streaming availability | later | Where to watch, fetched at nomination and lock only, with a 24h TTL. |
| 24 | Direct sponsorships | later | Direct-sold, contextual sponsorships: the long-term ad model. |
| 25 | Owner upgrade | later | A paid club tier, paid by one member, for clubs that want more than the free six seats. |
| 26 | Institutions tier | later | Organisations (schools, libraries, film societies) pay for their clubs. |
| 27 | Long-absence pause | later | A member can step out for months (parental leave, deployment) without being skipped every week. |
| 28 | Public genre clubs | later | `analysis-v2.md` §8 and the public-club column of its table: strangers in an asynchronous club. Needs moderation and a report path before launch. The only club pages where a labeled contextual ad or sponsored pick may ever appear. Ruled 2026-11-24 by Chanho: after launch. |

## The lawyer's list

Everything to settle in one review before public sign-ups open.

- **Terms and Privacy text**: the final wording, replacing the drafts.
- **CASL and reminder emails**: whether reminders are commercial electronic
  messages needing express consent, or messages about a relationship the
  person started, and what consent and unsubscribe rules follow; whether
  13–17s need different reminder defaults.
- **Processor change to AWS Canada**: Amazon SES in ca-central-1 replaced
  Brevo (France) on 2026-11-22; the Privacy text's processor section.
- **Reminders in the Privacy text**: reminder settings and unsubscribe
  links described.
- **The cookie list**: `kinomato_seen_from` was removed with Seen from,
  without a Privacy version bump, since less is collected.
- **13–17s and viewing data**: PIPEDA and BC PIPA for minors' accounts,
  and VPPA exposure for anything touching viewing data.
- **14A and 13-year-olds**: all-ages clubs and 13–17s allow CA 14A films,
  where a 13-year-old is meant to be accompanied by an adult. What, if
  anything, the app should say.
- **Contextual ads disclosure**: what the Terms and Privacy must say about
  contextual ads and direct sponsorships, given no tracking and no viewing
  data ever reaches an ad provider.
