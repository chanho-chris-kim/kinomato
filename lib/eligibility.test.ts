import { describe, expect, it } from "vitest";
import type { Constraint, ConstraintFilm } from "./constraints";
import { eligibleForNomination, filterNomineesAtLock } from "./eligibility";

const HORROR = 27;
const DRAMA = 18;
const SCIFI = 878;
const HEIST = 10051;

const film = (id: string, o: Partial<ConstraintFilm> = {}): ConstraintFilm => ({
  id,
  genreIds: [DRAMA],
  keywordIds: [1],
  runtime: 100,
  originalLanguage: "en",
  ...o,
});
const limit = (membershipId: string, o: Partial<Constraint> = {}): Constraint => ({
  id: `${membershipId}-${o.ruleType ?? "genre"}-${o.value ?? HORROR}-${o.kind ?? "hard"}`,
  membershipId,
  kind: "hard",
  ruleType: "genre",
  value: String(HORROR),
  appliesWhenAbsent: false,
  ...o,
});
const ids = (films: ConstraintFilm[]) => films.map((f) => f.id);

describe("eligibleForNomination (ruled 2026-11-12: every active member's hard limits; no RSVPs on a draft)", () => {
  const active = ["a", "b"];

  it("each rule type excludes what it names", () => {
    const films = [
      film("horror", { genreIds: [HORROR, DRAMA] }),
      film("heist", { keywordIds: [HEIST] }),
      film("long", { runtime: 200 }),
      film("french", { originalLanguage: "fr" }),
      film("fine"),
    ];
    expect(ids(eligibleForNomination(films, [limit("a")], active))).toEqual(["heist", "long", "french", "fine"]);
    expect(ids(eligibleForNomination(films, [limit("a", { ruleType: "keyword", value: String(HEIST) })], active))).toEqual([
      "horror",
      "long",
      "french",
      "fine",
    ]);
    expect(ids(eligibleForNomination(films, [limit("b", { ruleType: "runtime", value: "150" })], active))).toEqual([
      "horror",
      "heist",
      "french",
      "fine",
    ]);
    expect(ids(eligibleForNomination(films, [limit("b", { ruleType: "language", value: "FR" })], active))).toEqual([
      "horror",
      "heist",
      "long",
      "fine",
    ]);
  });

  it("missing film data: genre and keyword fail closed, runtime and language fail open", () => {
    const films = [
      film("no-genres", { genreIds: [] }),
      film("no-keywords", { keywordIds: [] }),
      film("no-runtime", { runtime: null }),
      film("no-language", { originalLanguage: null }),
    ];
    expect(ids(eligibleForNomination(films, [limit("a")], active))).toEqual(["no-keywords", "no-runtime", "no-language"]);
    expect(ids(eligibleForNomination(films, [limit("a", { ruleType: "keyword", value: String(HEIST) })], active))).toEqual([
      "no-genres",
      "no-runtime",
      "no-language",
    ]);
    // The others run 100 minutes; the one with no runtime isn't "over".
    expect(ids(eligibleForNomination(films, [limit("a", { ruleType: "runtime", value: "150" })], active))).toEqual([
      "no-genres",
      "no-keywords",
      "no-runtime",
      "no-language",
    ]);
    expect(ids(eligibleForNomination(films, [limit("a", { ruleType: "runtime", value: "90" })], active))).toEqual([
      "no-runtime",
    ]);
    expect(ids(eligibleForNomination(films, [limit("a", { ruleType: "language", value: "en" })], active))).toEqual([
      "no-language",
    ]);
  });

  it("every active member counts: nobody has RSVP'd on a draft, and no answer counts as attending", () => {
    const films = [film("horror", { genreIds: [HORROR] }), film("scifi", { genreIds: [SCIFI] })];
    const both = [limit("a"), limit("b", { value: String(SCIFI) })];
    expect(ids(eligibleForNomination(films, both, active))).toEqual([]);
  });

  it("soft preferences never exclude", () => {
    const films = [film("horror", { genreIds: [HORROR] })];
    expect(ids(eligibleForNomination(films, [limit("a", { kind: "soft" })], active))).toEqual(["horror"]);
    expect(ids(eligibleForNomination(films, [limit("a", { kind: "soft", appliesWhenAbsent: true })], active))).toEqual([
      "horror",
    ]);
  });

  it("a departed member's limit never applies (m0)", () => {
    const films = [film("horror", { genreIds: [HORROR] })];
    expect(ids(eligibleForNomination(films, [limit("gone")], active))).toEqual(["horror"]);
  });

  it("no limits, nothing excluded; no films, nothing eligible", () => {
    expect(ids(eligibleForNomination([film("x")], [], active))).toEqual(["x"]);
    expect(eligibleForNomination([], [limit("a")], active)).toEqual([]);
  });
});

describe("filterNomineesAtLock (once, scoped by RSVP)", () => {
  const nominations = [
    { id: "n-horror", filmId: "horror" },
    { id: "n-drama", filmId: "drama" },
  ];
  const films = [film("horror", { genreIds: [HORROR] }), film("drama", { genreIds: [DRAMA] })];
  const active = ["a", "b"];

  it("drops a nominee a hard limit now excludes, and keeps the rest", () => {
    expect(filterNomineesAtLock({ nominations, films, constraints: [limit("a")], rsvps: [], activeMembershipIds: active })).toEqual(
      { kept: [{ id: "n-drama", filmId: "drama" }], dropped: ["n-horror"] },
    );
  });

  it("no answer still counts as attending; an explicit no lifts the limit", () => {
    const yes = filterNomineesAtLock({
      nominations,
      films,
      constraints: [limit("a")],
      rsvps: [{ membershipId: "a", status: "yes" }],
      activeMembershipIds: active,
    });
    expect(yes.dropped).toEqual(["n-horror"]);
    const no = filterNomineesAtLock({
      nominations,
      films,
      constraints: [limit("a")],
      rsvps: [{ membershipId: "a", status: "no" }],
      activeMembershipIds: active,
    });
    expect(no).toEqual({ kept: nominations, dropped: [] });
  });

  it("applies_when_absent keeps the limit through an explicit no", () => {
    const result = filterNomineesAtLock({
      nominations,
      films,
      constraints: [limit("a", { appliesWhenAbsent: true })],
      rsvps: [{ membershipId: "a", status: "no" }],
      activeMembershipIds: active,
    });
    expect(result.dropped).toEqual(["n-horror"]);
  });

  it("a departed member's limit and RSVP never count", () => {
    expect(
      filterNomineesAtLock({
        nominations,
        films,
        constraints: [limit("gone", { appliesWhenAbsent: true })],
        rsvps: [{ membershipId: "gone", status: "yes" }],
        activeMembershipIds: active,
      }).dropped,
    ).toEqual([]);
  });

  it("everything excluded: nothing kept", () => {
    const result = filterNomineesAtLock({
      nominations,
      films,
      constraints: [limit("a"), limit("b", { value: String(DRAMA) })],
      rsvps: [],
      activeMembershipIds: active,
    });
    expect(result).toEqual({ kept: [], dropped: ["n-horror", "n-drama"] });
  });

  it("a nominee whose film data is missing is dropped by a genre limit (fails closed)", () => {
    const result = filterNomineesAtLock({
      nominations: [{ id: "n-blank", filmId: "blank" }],
      films: [film("blank", { genreIds: [] })],
      constraints: [limit("a")],
      rsvps: [],
      activeMembershipIds: active,
    });
    expect(result.dropped).toEqual(["n-blank"]);
  });

  it("a nominee whose film row is missing entirely is dropped, never served blind", () => {
    const result = filterNomineesAtLock({
      nominations: [{ id: "n-ghost", filmId: "ghost" }],
      films: [],
      constraints: [limit("a")],
      rsvps: [],
      activeMembershipIds: active,
    });
    expect(result.dropped).toEqual(["n-ghost"]);
  });
});
