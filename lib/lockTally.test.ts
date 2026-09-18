import { describe, expect, it } from "vitest";
import type { ConstraintFilm } from "./constraints";
import { pickWinningNomination } from "./lockTally";

function film(id: string, overrides: Partial<ConstraintFilm> = {}): ConstraintFilm {
  return { id, genreIds: [], keywordIds: [], runtime: null, originalLanguage: null, ...overrides };
}

describe("pickWinningNomination", () => {
  it("returns null when there are no nominations — nothing to lock", () => {
    const result = pickWinningNomination({
      nominations: [],
      votes: [],
      films: [],
      constraints: [],
      rsvps: [],
    });
    expect(result).toBeNull();
  });

  it("picks the nomination with the most votes", () => {
    const result = pickWinningNomination({
      nominations: [
        { id: "nom-a", filmId: "film-a" },
        { id: "nom-b", filmId: "film-b" },
      ],
      votes: [
        { nominationId: "nom-a" },
        { nominationId: "nom-a" },
        { nominationId: "nom-b" },
      ],
      films: [film("film-a"), film("film-b")],
      constraints: [],
      rsvps: [],
    });
    expect(result).toBe("nom-a");
  });

  it("breaks a vote tie using fewer soft-preference conflicts among attendees", () => {
    // nom-a and nom-b tie at 1 vote each. film-a matches a soft
    // preference held by an attending member; film-b matches none.
    const result = pickWinningNomination({
      nominations: [
        { id: "nom-a", filmId: "film-a" },
        { id: "nom-b", filmId: "film-b" },
      ],
      votes: [{ nominationId: "nom-a" }, { nominationId: "nom-b" }],
      films: [film("film-a", { genreIds: [27] }), film("film-b", { genreIds: [35] })],
      constraints: [
        {
          id: "c1",
          membershipId: "m1",
          kind: "soft",
          ruleType: "genre",
          value: "27",
          appliesWhenAbsent: false,
        },
      ],
      rsvps: [{ membershipId: "m1", status: "yes" }],
    });
    expect(result).toBe("nom-b");
  });

  it("falls back to nomination id ASC when votes and soft-conflict counts both tie", () => {
    const result = pickWinningNomination({
      nominations: [
        { id: "nom-z", filmId: "film-z" },
        { id: "nom-a", filmId: "film-a" },
      ],
      votes: [{ nominationId: "nom-z" }, { nominationId: "nom-a" }],
      films: [film("film-z"), film("film-a")],
      constraints: [],
      rsvps: [],
    });
    expect(result).toBe("nom-a");
  });

  it("a nomination with zero votes still wins if every nomination has zero votes", () => {
    const result = pickWinningNomination({
      nominations: [
        { id: "nom-a", filmId: "film-a" },
        { id: "nom-b", filmId: "film-b" },
      ],
      votes: [],
      films: [film("film-a"), film("film-b")],
      constraints: [],
      rsvps: [],
    });
    // Both tied at 0 votes and 0 conflicts — deterministic id fallback.
    expect(result).toBe("nom-a");
  });

  it("ignores a soft preference from a member who RSVP'd no — soft preferences only apply to explicit yes", () => {
    const result = pickWinningNomination({
      nominations: [
        { id: "nom-a", filmId: "film-a" },
        { id: "nom-b", filmId: "film-b" },
      ],
      votes: [{ nominationId: "nom-a" }, { nominationId: "nom-b" }],
      films: [film("film-a", { genreIds: [27] }), film("film-b", { genreIds: [35] })],
      constraints: [
        {
          id: "c1",
          membershipId: "m1",
          kind: "soft",
          ruleType: "genre",
          value: "27",
          appliesWhenAbsent: false,
        },
      ],
      // m1 said no, so their soft preference doesn't apply — both films
      // are equally conflict-free, falls to the id fallback.
      rsvps: [{ membershipId: "m1", status: "no" }],
    });
    expect(result).toBe("nom-a");
  });
});
