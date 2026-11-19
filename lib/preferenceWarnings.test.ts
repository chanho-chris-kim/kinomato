import { describe, expect, it } from "vitest";
import type { Constraint, ConstraintFilm, Rsvp } from "./constraints";
import { PREFERENCE_WARNING, preferenceWarnings } from "./preferenceWarnings";

const ROMANCE = 10749;
const film = (id: string, o: Partial<ConstraintFilm> = {}): ConstraintFilm => ({
  id,
  genreIds: [18],
  keywordIds: [1],
  runtime: 100,
  originalLanguage: "en",
  ...o,
});
const pref = (membershipId: string, o: Partial<Constraint> = {}): Constraint => ({
  id: `${membershipId}-pref`,
  membershipId,
  kind: "soft",
  ruleType: "genre",
  value: String(ROMANCE),
  appliesWhenAbsent: false,
  ...o,
});
const yes = (...ids: string[]): Rsvp[] => ids.map((membershipId) => ({ membershipId, status: "yes" }));

const romance = film("romance", { genreIds: [ROMANCE] });
const drama = film("drama");
const long = film("long", { runtime: 200 });
const active = ["me", "a", "b", "c", "d"];

const warn = (input: Partial<Parameters<typeof preferenceWarnings>[0]>) =>
  [
    ...preferenceWarnings({
      viewerMembershipId: "me",
      activeMembershipIds: active,
      rsvps: yes("a", "b", "c"),
      preferences: [pref("a")],
      films: [romance, drama, long],
      ...input,
    }),
  ].sort();

describe("preferenceWarnings (ruled 2026-11-18)", () => {
  it("says so on the matching nominee only, with three others coming", () => {
    expect(warn({})).toEqual(["romance"]);
    expect(PREFERENCE_WARNING).toBe("Someone coming would rather not.");
  });

  it("the anonymity threshold: two others coming, no warning for anyone", () => {
    expect(warn({ rsvps: yes("a", "b") })).toEqual([]);
    // The viewer's own yes doesn't count toward the three.
    expect(warn({ rsvps: yes("me", "a", "b") })).toEqual([]);
    expect(warn({ rsvps: yes("me", "a", "b", "c") })).toEqual(["romance"]);
  });

  it("only explicit yes counts: a no, or no answer, never does", () => {
    const rsvps: Rsvp[] = [...yes("b", "c", "d"), { membershipId: "a", status: "no" }];
    expect(warn({ rsvps })).toEqual([]);
    expect(warn({ rsvps: yes("b", "c", "d") })).toEqual([]); // a never answered
    // Not even applies_when_absent brings in someone who isn't coming.
    expect(warn({ rsvps: yes("b", "c", "d"), preferences: [pref("a", { appliesWhenAbsent: true })] })).toEqual([]);
  });

  it("only genre and runtime preferences; a topic preference never warns", () => {
    expect(warn({ preferences: [pref("a", { ruleType: "runtime", value: "150" })] })).toEqual(["long"]);
    expect(warn({ preferences: [pref("a", { ruleType: "keyword", value: "1" })] })).toEqual([]);
    expect(warn({ preferences: [pref("a", { ruleType: "language", value: "en" })] })).toEqual([]);
  });

  it("hard limits aren't preferences: they never produce this note", () => {
    expect(warn({ preferences: [pref("a", { kind: "hard" })] })).toEqual([]);
  });

  it("a departed member counts neither toward the three nor as a preference", () => {
    const stillHere = ["me", "b", "c"];
    expect(warn({ activeMembershipIds: stillHere, rsvps: yes("a", "b", "c") })).toEqual([]);
    expect(warn({ activeMembershipIds: [...active, "e"], rsvps: yes("b", "c", "d"), preferences: [pref("gone")] })).toEqual(
      [],
    );
  });

  it("the viewer's own preference counts like anyone's", () => {
    expect(warn({ rsvps: yes("me", "a", "b", "c"), preferences: [pref("me")] })).toEqual(["romance"]);
    // But not without saying yes themselves.
    expect(warn({ rsvps: yes("a", "b", "c"), preferences: [pref("me")] })).toEqual([]);
  });

  it("missing film data never warns (soft preferences never fail closed)", () => {
    expect(warn({ films: [film("blank", { genreIds: [] })] })).toEqual([]);
  });
});
