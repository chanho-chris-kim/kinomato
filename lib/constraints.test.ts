import { describe, expect, it } from "vitest";
import {
  canAddHardLimit,
  countSoftPreferenceConflicts,
  filterEligibleFilms,
  type Constraint,
  type ConstraintFilm,
  type Rsvp,
} from "./constraints";

function film(id: string, overrides: Partial<ConstraintFilm> = {}): ConstraintFilm {
  return {
    id,
    genres: [],
    keywords: [],
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
    value: "Horror",
    appliesWhenAbsent: false,
    ...overrides,
  };
}

const YES = (membershipId: string): Rsvp => ({ membershipId, status: "yes" });
const NO = (membershipId: string): Rsvp => ({ membershipId, status: "no" });

describe("filterEligibleFilms — hard limits", () => {
  it("excludes a film matching a hard limit from an explicit-yes member", () => {
    const horror = film("horror", { genres: ["Horror"] });
    const drama = film("drama", { genres: ["Drama"] });
    const result = filterEligibleFilms({
      films: [horror, drama],
      constraints: [constraint("dana", { kind: "hard", value: "Horror" })],
      rsvps: [YES("dana")],
    });
    expect(result.eligible.map((f) => f.id)).toEqual(["drama"]);
    expect(result.excluded.map((e) => e.film.id)).toEqual(["horror"]);
  });

  it("applies a hard limit even with no RSVP row at all — no answer counts as attending", () => {
    const horror = film("horror", { genres: ["Horror"] });
    const result = filterEligibleFilms({
      films: [horror],
      constraints: [constraint("dana", { kind: "hard", value: "Horror" })],
      rsvps: [], // dana never answered
    });
    expect(result.eligible).toEqual([]);
    expect(result.excluded.map((e) => e.film.id)).toEqual(["horror"]);
  });

  it("applies hard limits for everyone when the rsvps array is entirely empty", () => {
    const horror = film("horror", { genres: ["Horror"] });
    const long = film("long", { runtime: 200 });
    const result = filterEligibleFilms({
      films: [horror, long],
      constraints: [
        constraint("dana", { kind: "hard", ruleType: "genre", value: "Horror" }),
        constraint("marco", { kind: "hard", ruleType: "runtime", value: "150" }),
      ],
      rsvps: [],
    });
    expect(result.eligible).toEqual([]);
  });

  it("does not apply a hard limit from a member who explicitly RSVP'd no", () => {
    const horror = film("horror", { genres: ["Horror"] });
    const result = filterEligibleFilms({
      films: [horror],
      constraints: [constraint("dana", { kind: "hard", value: "Horror" })],
      rsvps: [NO("dana")],
    });
    expect(result.eligible.map((f) => f.id)).toEqual(["horror"]);
  });

  it("applies an absent member's hard limit anyway when applies_when_absent is set", () => {
    const horror = film("horror", { genres: ["Horror"] });
    const result = filterEligibleFilms({
      films: [horror],
      constraints: [
        constraint("dana", { kind: "hard", value: "Horror", appliesWhenAbsent: true }),
      ],
      rsvps: [NO("dana")],
    });
    expect(result.eligible).toEqual([]);
  });

  it("unions exclusions from two different attending members", () => {
    const horror = film("horror", { genres: ["Horror"] });
    const long = film("long", { genres: ["Drama"], runtime: 200 });
    const short = film("short", { genres: ["Drama"], runtime: 90 });
    const result = filterEligibleFilms({
      films: [horror, long, short],
      constraints: [
        constraint("dana", { kind: "hard", ruleType: "genre", value: "Horror" }),
        constraint("marco", { kind: "hard", ruleType: "runtime", value: "150" }),
      ],
      rsvps: [YES("dana"), YES("marco")],
    });
    expect(result.eligible.map((f) => f.id)).toEqual(["short"]);
  });

  it("leaves a film matching no constraint eligible", () => {
    const drama = film("drama", { genres: ["Drama"] });
    const result = filterEligibleFilms({
      films: [drama],
      constraints: [constraint("dana", { kind: "hard", value: "Horror" })],
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
      constraints: [constraint("dana", { kind: "hard", ruleType: "runtime", value: "150" })],
      rsvps: [YES("dana")],
    });
    // Exactly 150 is not "over" 150. An unknown runtime never triggers
    // the limit — we can't exclude what we don't know violates it.
    expect(result.eligible.map((f) => f.id).sort()).toEqual([
      "exactly",
      "under",
      "unknown",
    ]);
  });

  it("matches language and keyword rule types", () => {
    const french = film("french", { originalLanguage: "fr" });
    const heist = film("heist", { keywords: ["heist"] });
    const plain = film("plain", { originalLanguage: "en", keywords: ["road trip"] });
    const result = filterEligibleFilms({
      films: [french, heist, plain],
      constraints: [
        constraint("dana", { kind: "hard", ruleType: "language", value: "fr" }),
        constraint("marco", { kind: "hard", ruleType: "keyword", value: "heist" }),
      ],
      rsvps: [YES("dana"), YES("marco")],
    });
    expect(result.eligible.map((f) => f.id)).toEqual(["plain"]);
  });
});

describe("filterEligibleFilms — soft preferences", () => {
  it("never excludes a film for a soft-preference match", () => {
    const horror = film("horror", { genres: ["Horror"] });
    const result = filterEligibleFilms({
      films: [horror],
      constraints: [constraint("dana", { kind: "soft", value: "Horror" })],
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
    const horror = film("horror", { genres: ["Horror"] });
    const result = countSoftPreferenceConflicts(
      [horror],
      [constraint("dana", { kind: "soft", value: "Horror" })],
      [YES("dana")],
    );
    expect(result).toEqual([{ film: horror, conflictCount: 1 }]);
  });

  it("does not count a soft preference from a member with no RSVP row", () => {
    const horror = film("horror", { genres: ["Horror"] });
    const result = countSoftPreferenceConflicts(
      [horror],
      [constraint("dana", { kind: "soft", value: "Horror" })],
      [], // no response — soft preferences require explicit yes
    );
    expect(result).toEqual([{ film: horror, conflictCount: 0 }]);
  });

  it("does not count a soft preference from a member who RSVP'd no", () => {
    const horror = film("horror", { genres: ["Horror"] });
    const result = countSoftPreferenceConflicts(
      [horror],
      [constraint("dana", { kind: "soft", value: "Horror" })],
      [NO("dana")],
    );
    expect(result).toEqual([{ film: horror, conflictCount: 0 }]);
  });

  it("counts an absent member's soft preference anyway when applies_when_absent is set", () => {
    const horror = film("horror", { genres: ["Horror"] });
    const result = countSoftPreferenceConflicts(
      [horror],
      [constraint("dana", { kind: "soft", value: "Horror", appliesWhenAbsent: true })],
      [NO("dana")],
    );
    expect(result).toEqual([{ film: horror, conflictCount: 1 }]);
  });

  it("counts distinct attending members, not distinct constraint rows", () => {
    const horror = film("horror", { genres: ["Horror"] });
    const result = countSoftPreferenceConflicts(
      [horror],
      [
        constraint("dana", { kind: "soft", value: "Horror" }),
        constraint("marco", { kind: "soft", value: "Horror" }),
      ],
      [YES("dana"), YES("marco")],
    );
    expect(result).toEqual([{ film: horror, conflictCount: 2 }]);
  });

  it("reports zero for a film nobody has a soft preference against", () => {
    const drama = film("drama", { genres: ["Drama"] });
    const result = countSoftPreferenceConflicts(
      [drama],
      [constraint("dana", { kind: "soft", value: "Horror" })],
      [YES("dana")],
    );
    expect(result).toEqual([{ film: drama, conflictCount: 0 }]);
  });

  it("ignores hard limits entirely — they're a different mechanism", () => {
    const horror = film("horror", { genres: ["Horror"] });
    const result = countSoftPreferenceConflicts(
      [horror],
      [constraint("dana", { kind: "hard", value: "Horror" })],
      [YES("dana")],
    );
    expect(result).toEqual([{ film: horror, conflictCount: 0 }]);
  });

  it("returns results in input film order — it does not sort", () => {
    const b = film("b", { genres: ["Horror"] });
    const a = film("a");
    const result = countSoftPreferenceConflicts(
      [b, a],
      [constraint("dana", { kind: "soft", value: "Horror" })],
      [YES("dana")],
    );
    expect(result.map((r) => r.film.id)).toEqual(["b", "a"]);
  });
});
