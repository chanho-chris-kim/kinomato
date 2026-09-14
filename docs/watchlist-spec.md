# Kinomato — Watchlist & Lock Screen Spec

*Companion to the v2 project analysis. Slots in as a new section between product/UX and engineering.*

---

## 0. The principle: nerdy is the moat, fun is the retention

Letterboxd owns "log what you watched." Nobody owns **"know things about what your group watches."** Every nerdy feature here is derived from data only Kinomato has — your club's history, your club's overlapping lists, your club's ratings over time. That's not a feature a competitor can copy by adding a database; they'd have to have your clubs.

Two rules for the whole surface:

- **Fun must never cost a tap.** Trivia, connections, and stats appear where the user was already looking. Nothing fun lives behind a menu.
- **Nerdy means specific.** "Michael Mann's first theatrical feature" is nerdy. "A gripping crime thriller" is a synopsis. If a fact could apply to fifty films, cut it.

---

## 1. Adding a film

### 1.1 The disambiguation problem

Most film apps fail here. A user types "heat" and gets twelve results with identical titles and no way to tell them apart. Every search result row must carry enough to decide without tapping through:

| Element | Why it's there |
|---|---|
| Poster thumbnail (44×66) | Recognition beats reading. Most people identify a film by its poster first. |
| Title + **year** | The primary disambiguator. Always adjacent to the title, never on a second line. |
| **Director** | The second disambiguator, and the one film nerds actually use. |
| **Two or three lead actors** | The disambiguator everyone else uses. |
| **Genre chips** | Fast scanning, and it's how the list will later be organized. |
| **Runtime** | Decides more movie nights than anything else. Surface it early. |
| Club overlap badge | "3 in your club want this" — only we can show this. |
| Already-watched badge | "club watched this · week 9" — prevents the most common duplicate. |

Results rank by popularity, but **any film already on another club member's list floats to the top** regardless. If three friends already want it, that's more relevant than global popularity.

### 1.2 Additional search modes

Search should accept more than titles, because film people don't always think in titles:

- **By person** — "wong kar-wai" returns his filmography, tappable to add several at once. A director's whole run is a common way to build a list.
- **By keyword** — TMDB exposes keywords, which makes "heist", "one location", "christmas" workable.
- **Paste a URL** — someone shares a Letterboxd or TMDB link in the group chat. Paste it, get the film. Zero friction, and it's how films will actually arrive.
- **Import a CSV** — a Letterboxd export lands 200 films at once. Biggest onboarding accelerant available.

### 1.3 After selection

One confirmation sheet, two optional fields:

- **A note** — "Dana said this is the best thing she saw last year." This is what turns a list into a conversation, and it's what the group sees at nomination time.
- **Tags** — free-text, personal. "rainy sunday", "when I can focus", "show Marco". Users invent better taxonomies than we can.

Then it's added. No further steps.

---

## 2. Organizing the list

### 2.1 Default view: genre shelves

The list opens as **poster tiles grouped into genre shelves**, three across, with a count per shelf. It reads like a video store, which is the right feeling.

**One film, one shelf.** Films have multiple genres, and putting *Hot Fuzz* under both Comedy and Action means the list looks bigger than it is and nothing is ever where you left it. Use the primary genre for placement; show all genres on the detail view.

**Shelf order** is by size, largest first — so the list immediately tells you what kind of viewer you are. Shelves with one film collapse into a single "Everything else" shelf at the bottom.

### 2.2 Smart shelves

Above the genre shelves, computed shelves that earn their place:

- **Everyone wants these** — on three or more club lists. The highest-value shelf in the product, and the one that makes nominating easy.
- **Leaving soon** — dropping off a service someone in the club subscribes to within 30 days. Creates genuine, non-manufactured urgency.
- **Short enough for a school night** — under 100 minutes.
- **You've had this the longest** — added over a year ago, never picked. Gently funny, and it actually gets films watched.

Smart shelves only appear when they have at least two films. An empty smart shelf is worse than no smart shelf.

### 2.3 Alternate views

A chip row switches the grouping, and the choice persists:

| View | Grouping |
|---|---|
| **Genre** (default) | Primary genre shelves |
| **Runtime** | Under 90 / 90–120 / 120–150 / the long ones |
| **Decade** | 2020s back to pre-1960, which makes the shape of someone's taste obvious |
| **Streaming** | Grouped by service, with "not streaming anywhere" last |
| **Added** | Reverse chronological, for finding the thing you just added |

**Runtime and Streaming are the two people will actually use in the moment.** Genre is for browsing; those two are for deciding.

### 2.4 The header line

`12 films · 21h 40m`

Total runtime is a small thing that lands unexpectedly well. It reframes a watchlist from a pile of intentions into a measurable amount of life, and it's the kind of number people screenshot.

---

## 3. The nerd layer

These are computed from data we already have. None require a new integration.

**On the list:**
- **Director clusters** — "you have four Wong Kar-wai films." Tappable to see them together.
- **Decade histogram** — a six-bar sparkline. Instantly legible, zero explanation needed.
- **Taste summary** — "your list is 43% crime, and half of it is from before 1990."
- **The gap** — "nobody in your club has a single comedy on their list." A prompt, not a criticism.

**On a film:**
- Who else in the club wants it, and when they added it.
- Their notes.
- Whether the club has watched anything by this director, and what it scored.
- Whether it connects to a past pick by cast, crew, or country.

**Season-level:**
- Total runtime watched, oldest and newest film, most-represented decade and country.
- **The two-axis map** — every film the club watched plotted on quality against fun. The scatter is the single most shareable artifact in the product, because the outliers are always funny.

---

## 4. The lock screen

Lock is the emotional peak of the week. The decision is over, the plan is real, and there's still anticipation left. It's the right place to spend the fun budget.

### 4.1 What's on it

1. **Locked pill and countdown.** Two days, four hours. The countdown does the anticipation work by itself.
2. **Title, year, director, and the vote result.** "Won 4–1" is a small pleasure and it reveals the votes that were live before.
3. **The runtime math.** Starts 8:00, runs 123 minutes, **out by 10:03pm.** Nobody else computes this and everybody wants to know it. For anything over 150 minutes, add a suggested intermission.
4. **Your club has form.** The best feature on the screen. "Marco picked *Heat* back in week 6. Same director, fourteen years later." This is only possible because we have the club's history, and it is the thing people will screenshot into the group chat.
5. **Worth knowing.** Three specific facts, no synopsis, no spoilers. Never four — three is where it stays a treat instead of homework.
6. **Where to watch**, with how many members have that service.
7. **Order by 7:10pm** — the timing hook from the commerce section, landing exactly where it's useful.
8. **Call it now.** A one-tap prediction on the club's eventual fun score. Costs nothing, creates a reason to come back and see, and feeds the season awards.

### 4.2 Sourcing the "worth knowing" facts

This needs flagging because it's the one part of this spec with a real supply problem.

- **Derivable from TMDB:** crew credits, keywords, country, language, budget and revenue, release dates, a director's other work. "Mann's first theatrical feature" is a date comparison, not a licensed fact. Lean on these heavily — a surprising amount of good trivia is just a query.
- **Wikipedia and Wikidata:** openly licensed and usable with attribution. The realistic source for production anecdotes.
- **Club-derived:** the "your club has form" connections. Free, infinite, unique to us, and better than anything licensed.
- **Do not scrape IMDb.** Their trivia is the obvious source and it is not licensed for this. It's a legal exposure with no upside.

Practical approach: derive what you can, pull the rest from Wikidata, and **fall back to a club connection when there's nothing good.** Better to show one strong club-specific line than three generic ones. If nothing interesting exists for a film, show nothing — an empty trivia block is fine, a boring one is not.

---

## 5. Engineering notes

Additions to the v2 schema:

```
films            + directors[], cast[] (top 5), keywords[],
                   primary_genre, country, original_language,
                   release_date, budget, revenue
watchlist_items  + note, tags[]
film_facts       id, film_id, text, source (tmdb|wikidata|derived),
                   source_url, verified_at
club_connections computed at lock, cached on the night row
```

- **Cache film metadata aggressively.** Films don't change. One fetch per film per club-universe, indefinite TTL, refresh only on manual request. This is what keeps you under the TMDB rate limits.
- **Availability is the opposite** — 24h TTL, fetched only at nomination and lock, never on browse.
- **`club_connections` is a query, not a job.** At lock, look for shared director, shared lead actor, same country, or same decade against the club's watched history, rank by rarity, take the best one. Rarity matters: "also a crime film" is worthless, "also shot by Robby Müller" is delightful.
- **Posters need a placeholder strategy.** TMDB doesn't have art for everything. A title-and-year card in the club's theme colors is better than a broken image, and arguably looks better in a grid.
