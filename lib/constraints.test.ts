import { describe, expect, it } from "vitest";
import {
  canAddHardLimit,
  countSoftPreferenceConflicts,
  filterEligibleFilms,
  type Constraint,
  type ConstraintFilm,
  type Rsvp,
} from "./constraints";

// Real TMDB genre ids, so tests read naturally.
const GENRE_HORROR = 27;
const GENRE_SCIFI = 878;
const GENRE_DRAMA = 18;
const KEYWORD_HEIST = 10051;

function film(id: string, overrides: Partial<ConstraintFilm> = {}): ConstraintFilm {
  return {
    id,
    genreIds: [],
    keywordIds: [],
    runtime: null,
    originalLanguage: null,
    ...overrides,
  };
}

function constraint(
  membershipId: string,
  overrides: Partial<Constraint> = {},
): Constraint {
  return {
    id: `${membershipId}-constraint`,
    membershipId,
    kind: "hard",
    ruleType: "genre",
    value: String(GENRE_HORROR),
    appliesWhenAbsent: false,
    ...overrides,
  };
}

const YES = (membershipId: string): Rsvp => ({ membershipId, status: "yes" });
const NO = (membershipId: string): Rsvp => ({ membershipId, status: "no" });

describe("filterEligibleFilms — hard limits", () => {
  it("excludes a film matching a hard limit from an explicit-yes member", () => {
    const horror = film("horror", { genreIds: [GENRE_HORROR] });
    const drama = film("drama", { genreIds: [GENRE_DRAMA] });
    const result = filterEligibleFilms({
      films: [horror, drama],
      constraints: [constraint("dana")],
      rsvps: [YES("dana")],
    });
    expect(result.eligible.map((f) => f.id)).toEqual(["drama"]);
    expect(result.excluded.map((e) => e.film.id)).toEqual(["horror"]);
  });

  it("matches by genre id even when the film's and constraint's display strings differ", () => {
    const scifi = film("scifi", {
      genreIds: [GENRE_SCIFI],
      genres: ["Sci-Fi"], // display string, deliberately different
    });
    const result = filterEligibleFilms({
      films: [scifi],
      constraints: [
        constraint("dana", {
          ruleType: "genre",
          value: String(GENRE_SCIFI),
          label: "Science Fiction", // deliberately different display label
        }),
      ],
      rsvps: [YES("dana")],
    });
    // Matches by id despite "Sci-Fi" vs "Science Fiction" never agreeing
    // as strings.
    expect(result.eligible).toEqual([]);
    expect(result.excluded.map((e) => e.film.id)).toEqual(["scifi"]);
  });

  it("applies a hard limit even with no RSVP row at all — no answer counts as attending", () => {
    const horror = film("horror", { genreIds: [GENRE_HORROR] });
    const result = filterEligibleFilms({
      films: [horror],
      constraints: [constraint("dana")],
      rsvps: [], // dana never answered
    });
    expect(result.eligible).toEqual([]);
    expect(result.excluded.map((e) => e.film.id)).toEqual(["horror"]);
  });

  it("applies hard limits for everyone when the rsvps array is entirely empty", () => {
    const horror = film("horror", { genreIds: [GENRE_HORROR] });
    const long = film("long", { runtime: 200 });
    const result = filterEligibleFilms({
      films: [horror, long],
      constraints: [
        constraint("dana", { ruleType: "genre", value: String(GENRE_HORROR) }),
        constraint("marco", { ruleType: "runtime", value: "150" }),
      ],
      rsvps: [],
    });
    expect(result.eligible).toEqual([]);
  });

  it("does not apply a hard limit from a member who explicitly RSVP'd no", () => {
    const horror = film("horror", { genreIds: [GENRE_HORROR] });
    const result = filterEligibleFilms({
      films: [horror],
      constraints: [constraint("dana")],
      rsvps: [NO("dana")],
    });
    expect(result.eligible.map((f) => f.id)).toEqual(["horror"]);
  });

  it("applies an absent member's hard limit anyway when applies_when_absent is set", () => {
    const horror = film("horror", { genreIds: [GENRE_HORROR] });
    const result = filterEligibleFilms({
      films: [horror],
      constraints: [constraint("dana", { appliesWhenAbsent: true })],
      rsvps: [NO("dana")],
    });
    expect(result.eligible).toEqual([]);
  });

  it("unions exclusions from two different attending members", () => {
    const horror = film("horror", { genreIds: [GENRE_HORROR] });
    const long = film("long", { genreIds: [GENRE_DRAMA], runtime: 200 });
    const short = film("short", { genreIds: [GENRE_DRAMA], runtime: 90 });
    const result = filterEligibleFilms({
      films: [horror, long, short],
      constraints: [
        constraint("dana", { ruleType: "genre", value: String(GENRE_HORROR) }),
        constraint("marco", { ruleType: "runtime", value: "150" }),
      ],
      rsvps: [YES("dana"), YES("marco")],
    });
    expect(result.eligible.map((f) => f.id)).toEqual(["short"]);
  });

  it("leaves a film matching no constraint eligible", () => {
    const drama = film("drama", { genreIds: [GENRE_DRAMA] });
    const result = filterEligibleFilms({
      films: [drama],
      constraints: [constraint("dana")],
      rsvps: [YES("dana")],
    });
    expect(result.eligible.map((f) => f.id)).toEqual(["drama"]);
  });

  it("matches runtime as a strict upper bound in whole minutes", () => {
    const over = film("over", { runtime: 151 });
    const exactly = film("exactly", { runtime: 150 });
    const under = film("under", { runtime: 149 });
    const unknown = film("unknown", { runtime: null });
    const result = filterEligibleFilms({
      films: [over, exactly, under, unknown],
      constraints: [constraint("dana", { ruleType: "runtime", value: "150" })],
      rsvps: [YES("dana")],
    });
    // Exactly 150 is not "over" 150. An unknown runtime never triggers
    // the limit — runtime is logistics, not safety, so missing data
    // fails open here.
    expect(result.eligible.map((f) => f.id).sort()).toEqual([
      "exactly",
      "under",
      "unknown",
    ]);
  });

  it("matches keyword and language rule types", () => {
    const french = film("french", { originalLanguage: "fr" });
    const heist = film("heist", { keywordIds: [KEYWORD_HEIST] });
    const plain = film("plain", {
      originalLanguage: "en",
      keywordIds: [999],
    });
    const result = filterEligibleFilms({
      films: [french, heist, plain],
      constraints: [
        constraint("dana", { ruleType: "language", value: "fr" }),
        constraint("marco", { ruleType: "keyword", value: String(KEYWORD_HEIST) }),
      ],
      rsvps: [YES("dana"), YES("marco")],
    });
    expect(result.eligible.map((f) => f.id)).toEqual(["plain"]);
  });

  describe("missing-data policy", () => {
    it("excludes a film with empty genreIds when a genre hard limit is active", () => {
      const unknownGenre = film("unknown-genre", { genreIds: [] });
      const result = filterEligibleFilms({
        films: [unknownGenre],
        constraints: [constraint("dana", { ruleType: "genre", value: String(GENRE_HORROR) })],
        rsvps: [YES("dana")],
      });
      // Can't confirm it isn't horror, so don't serve it.
      expect(result.eligible).toEqual([]);
    });

    it("excludes a film with empty keywordIds when a keyword hard limit is active", () => {
      const unknownKeyword = film("unknown-keyword", { keywordIds: [] });
      const result = filterEligibleFilms({
        films: [unknownKeyword],
        constraints: [
          constraint("dana", { ruleType: "keyword", value: String(KEYWORD_HEIST) }),
        ],
        rsvps: [YES("dana")],
      });
      expect(result.eligible).toEqual([]);
    });

    it("excludes a film with null originalLanguage when a language hard limit is active", () => {
      const unknownLanguage = film("unknown-language", { originalLanguage: null });
      const result = filterEligibleFilms({
        films: [unknownLanguage],
        constraints: [constraint("dana", { ruleType: "language", value: "fr" })],
        rsvps: [YES("dana")],
      });
      expect(result.eligible).toEqual([]);
    });

    it("does NOT exclude a film with null runtime when a runtime hard limit is active", () => {
      const unknownRuntime = film("unknown-runtime", { runtime: null });
      const result = filterEligibleFilms({
        films: [unknownRuntime],
        constraints: [constraint("dana", { ruleType: "runtime", value: "150" })],
        rsvps: [YES("dana")],
      });
      // Runtime is logistics, not safety — missing data fails open.
      expect(result.eligible.map((f) => f.id)).toEqual(["unknown-runtime"]);
    });
  });
});

describe("filterEligibleFilms — soft preferences", () => {
  it("never excludes a film for a soft-preference match", () => {
    const horror = film("horror", { genreIds: [GENRE_HORROR] });
    const result = filterEligibleFilms({
      films: [horror],
      constraints: [constraint("dana", { kind: "soft" })],
      rsvps: [YES("dana")],
    });
    expect(result.eligible.map((f) => f.id)).toEqual(["horror"]);
  });
});

describe("canAddHardLimit", () => {
  it("allows a third constraint when fewer than two are hard", () => {
    const existing: Constraint[] = [
      constraint("dana", { kind: "hard" }),
      constraint("dana", { kind: "soft" }),
      constraint("dana", { kind: "soft" }),
    ];
    expect(canAddHardLimit(existing)).toBe(true);
  });

  it("rejects a third hard limit once two exist", () => {
    const existing: Constraint[] = [
      constraint("dana", { kind: "hard" }),
      constraint("dana", { kind: "hard" }),
    ];
    expect(canAddHardLimit(existing)).toBe(false);
  });

  it("allows the first hard limit for a membership with no constraints yet", () => {
    expect(canAddHardLimit([])).toBe(true);
  });
});

describe("countSoftPreferenceConflicts", () => {
  it("counts a soft preference from an explicit-yes member", () => {
    const horror = film("horror", { genreIds: [GENRE_HORROR] });
    const result = countSoftPreferenceConflicts(
      [horror],
      [constraint("dana", { kind: "soft" })],
      [YES("dana")],
    );
    expect(result).toEqual([{ film: horror, conflictCount: 1 }]);
  });

  it("does not count a soft preference from a member with no RSVP row", () => {
    const horror = film("horror", { genreIds: [GENRE_HORROR] });
    const result = countSoftPreferenceConflicts(
      [horror],
      [constraint("dana", { kind: "soft" })],
      [], // no response — soft preferences require explicit yes
    );
    expect(result).toEqual([{ film: horror, conflictCount: 0 }]);
  });

  it("does not count a soft preference from a member who RSVP'd no", () => {
    const horror = film("horror", { genreIds: [GENRE_HORROR] });
    const result = countSoftPreferenceConflicts(
      [horror],
      [constraint("dana", { kind: "soft" })],
      [NO("dana")],
    );
    expect(result).toEqual([{ film: horror, conflictCount: 0 }]);
  });

  it("counts an absent member's soft preference anyway when applies_when_absent is set", () => {
    const horror = film("horror", { genreIds: [GENRE_HORROR] });
    const result = countSoftPreferenceConflicts(
      [horror],
      [constraint("dana", { kind: "soft", appliesWhenAbsent: true })],
      [NO("dana")],
    );
    expect(result).toEqual([{ film: horror, conflictCount: 1 }]);
  });

  it("does not count a soft preference against a film with empty genreIds (fails open)", () => {
    const unknownGenre = film("unknown-genre", { genreIds: [] });
    const result = countSoftPreferenceConflicts(
      [unknownGenre],
      [constraint("dana", { kind: "soft" })],
      [YES("dana")],
    );
    expect(result).toEqual([{ film: unknownGenre, conflictCount: 0 }]);
  });

  it("counts distinct attending members, not distinct constraint rows", () => {
    const horror = film("horror", { genreIds: [GENRE_HORROR] });
    const result = countSoftPreferenceConflicts(
      [horror],
      [
        constraint("dana", { kind: "soft" }),
        constraint("marco", { kind: "soft" }),
      ],
      [YES("dana"), YES("marco")],
    );
    expect(result).toEqual([{ film: horror, conflictCount: 2 }]);
  });

  it("reports zero for a film nobody has a soft preference against", () => {
    const drama = film("drama", { genreIds: [GENRE_DRAMA] });
    const result = countSoftPreferenceConflicts(
      [drama],
      [constraint("dana", { kind: "soft" })],
      [YES("dana")],
    );
    expect(result).toEqual([{ film: drama, conflictCount: 0 }]);
  });

  it("ignores hard limits entirely — they're a different mechanism", () => {
    const horror = film("horror", { genreIds: [GENRE_HORROR] });
    const result = countSoftPreferenceConflicts(
      [horror],
      [constraint("dana", { kind: "hard" })],
      [YES("dana")],
    );
    expect(result).toEqual([{ film: horror, conflictCount: 0 }]);
  });

  it("returns results in input film order — it does not sort", () => {
    const b = film("b", { genreIds: [GENRE_HORROR] });
    const a = film("a");
    const result = countSoftPreferenceConflicts(
      [b, a],
      [constraint("dana", { kind: "soft" })],
      [YES("dana")],
    );
    expect(result.map((r) => r.film.id)).toEqual(["b", "a"]);
  });
});
