import { describe, expect, it } from "vitest";
import { describeLimit, MOVIE_GENRES, readLimitForm } from "./constraintForm";

const none: { kind: "hard" | "soft"; ruleType: string; value: string }[] = [];
const form = (o: Partial<Record<"kind" | "ruleType" | "genre" | "minutes", unknown>>) => ({
  kind: "hard",
  ruleType: "genre",
  genre: "27",
  minutes: "",
  ...o,
});

describe("MOVIE_GENRES", () => {
  it("is TMDB's 19 movie genres, ids unique", () => {
    expect(MOVIE_GENRES).toHaveLength(19);
    expect(new Set(MOVIE_GENRES.map((g) => g.id)).size).toBe(19);
    expect(MOVIE_GENRES.find((g) => g.id === 27)?.label).toBe("Horror");
    expect(MOVIE_GENRES.find((g) => g.id === 878)?.label).toBe("Science Fiction");
  });
});

describe("readLimitForm (validated at write time)", () => {
  it("a genre limit stores the TMDB id, with the label for display only", () => {
    expect(readLimitForm(form({}), none)).toEqual({
      ok: true,
      limit: { kind: "hard", ruleType: "genre", value: "27", label: "Horror" },
    });
    expect(readLimitForm(form({ kind: "soft", genre: "10749" }), none)).toEqual({
      ok: true,
      limit: { kind: "soft", ruleType: "genre", value: "10749", label: "Romance" },
    });
  });

  it("a length limit is 'nothing over N minutes', N from 30 to 400", () => {
    expect(readLimitForm(form({ ruleType: "runtime", minutes: " 150 " }), none)).toEqual({
      ok: true,
      limit: { kind: "hard", ruleType: "runtime", value: "150", label: null },
    });
    for (const ok of ["30", "400"]) expect(readLimitForm(form({ ruleType: "runtime", minutes: ok }), none).ok).toBe(true);
    for (const bad of ["29", "401", "90.5", "", "two hours", "-60", "1e2", null]) {
      expect(readLimitForm(form({ ruleType: "runtime", minutes: bad }), none), String(bad)).toEqual({
        ok: false,
        error: "Length must be a whole number of minutes from 30 to 400.",
      });
    }
  });

  it("only hard or soft, only genre or length (keyword and language aren't offered yet)", () => {
    expect(readLimitForm(form({ kind: "veto" }), none)).toEqual({ ok: false, error: "Choose hard limit or preference." });
    for (const ruleType of ["keyword", "language", "rating", ""]) {
      expect(readLimitForm(form({ ruleType }), none), ruleType).toEqual({
        ok: false,
        error: "Choose a genre or a length.",
      });
    }
  });

  it("a genre must be one of the list, by id", () => {
    for (const bad of ["Horror", "99999", "", "27.0", null]) {
      expect(readLimitForm(form({ genre: bad }), none), String(bad)).toEqual({
        ok: false,
        error: "Choose a genre from the list.",
      });
    }
  });

  it("refuses a duplicate of one you already have, hard or soft", () => {
    const existing = [{ kind: "soft" as const, ruleType: "genre", value: "27" }];
    expect(readLimitForm(form({}), existing)).toEqual({ ok: false, error: "You already have that one." });
    const runtime = [{ kind: "hard" as const, ruleType: "runtime", value: "150" }];
    expect(readLimitForm(form({ ruleType: "runtime", minutes: "150", kind: "soft" }), runtime)).toEqual({
      ok: false,
      error: "You already have that one.",
    });
    expect(readLimitForm(form({ ruleType: "runtime", minutes: "120" }), runtime).ok).toBe(true);
  });

  it("two hard limits each; preferences have no cap", () => {
    const two = [
      { kind: "hard" as const, ruleType: "genre", value: "27" },
      { kind: "hard" as const, ruleType: "runtime", value: "150" },
    ];
    expect(readLimitForm(form({ genre: "53" }), two)).toEqual({
      ok: false,
      error: "You have two hard limits. Remove one, or add this as a preference.",
    });
    expect(readLimitForm(form({ kind: "soft", genre: "53" }), two).ok).toBe(true);
    const manySoft = MOVIE_GENRES.slice(0, 10).map((g) => ({ kind: "soft" as const, ruleType: "genre", value: String(g.id) }));
    expect(readLimitForm(form({ kind: "soft", genre: "10770" }), manySoft).ok).toBe(true);
  });
});

describe("describeLimit", () => {
  it("in plain words", () => {
    expect(describeLimit({ kind: "hard", ruleType: "genre", value: "27", label: "Horror" })).toBe("Hard limit: Horror");
    expect(describeLimit({ kind: "soft", ruleType: "genre", value: "10749", label: null })).toBe("Prefer not: Romance");
    expect(describeLimit({ kind: "hard", ruleType: "runtime", value: "120", label: null })).toBe(
      "Hard limit: Nothing over 2h",
    );
    expect(describeLimit({ kind: "soft", ruleType: "runtime", value: "135", label: null })).toBe(
      "Prefer not: Nothing over 2h 15m",
    );
  });

  it("falls back to the stored label for anything the form doesn't offer yet", () => {
    expect(describeLimit({ kind: "hard", ruleType: "keyword", value: "1", label: "body horror" })).toBe(
      "Hard limit: body horror",
    );
  });
});
