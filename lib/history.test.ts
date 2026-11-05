import { describe, expect, it } from "vitest";
import { ratingsView, tallyNight, terminalNightsNewestFirst } from "./history";

const at = (iso: string) => new Date(iso);

describe("terminalNightsNewestFirst", () => {
  it("keeps watched, cancelled and unconfirmed nights, newest first", () => {
    const nights = [
      { id: "w-old", state: "watched" as const, scheduledAt: at("2026-09-05T00:00:00Z") },
      { id: "draft", state: "draft" as const, scheduledAt: at("2026-11-07T00:00:00Z") },
      { id: "c", state: "cancelled" as const, scheduledAt: at("2026-10-03T00:00:00Z") },
      { id: "open", state: "open" as const, scheduledAt: at("2026-10-31T00:00:00Z") },
      { id: "u", state: "unconfirmed" as const, scheduledAt: at("2026-10-17T00:00:00Z") },
      { id: "locked", state: "locked" as const, scheduledAt: at("2026-10-24T00:00:00Z") },
      { id: "w-new", state: "watched" as const, scheduledAt: at("2026-10-10T00:00:00Z") },
    ];
    expect(terminalNightsNewestFirst(nights).map((n) => n.id)).toEqual(["u", "w-new", "c", "w-old"]);
  });

  it("an empty history is empty", () => {
    expect(terminalNightsNewestFirst([])).toEqual([]);
  });
});

describe("tallyNight", () => {
  const nominations = [
    { id: "n1", filmId: "f1" },
    { id: "n2", filmId: "f2" },
    { id: "n3", filmId: "f3" },
  ];

  it("counts per nominee from vote nomination ids alone, winner first and marked", () => {
    const tally = tallyNight(nominations, ["n2", "n1", "n2", "n2", "n1"], "f2");
    expect(tally).toEqual([
      { nominationId: "n2", filmId: "f2", count: 3, winner: true },
      { nominationId: "n1", filmId: "f1", count: 2, winner: false },
      { nominationId: "n3", filmId: "f3", count: 0, winner: false },
    ]);
  });

  it("the winner comes first even when a tie-break decided it", () => {
    const tally = tallyNight(nominations, ["n1", "n3"], "f3");
    expect(tally.map((t) => [t.filmId, t.count, t.winner])).toEqual([
      ["f3", 1, true],
      ["f1", 1, false],
      ["f2", 0, false],
    ]);
  });

  it("no winner (a cancelled night): nobody marked", () => {
    expect(tallyNight(nominations, ["n1"], null).some((t) => t.winner)).toBe(false);
  });

  it("ignores votes for nominations that aren't this night's", () => {
    expect(tallyNight(nominations, ["elsewhere", "n1"], "f1")[0].count).toBe(1);
  });

  it("carries no voter identity: each row is exactly nominee, film, count, winner", () => {
    for (const row of tallyNight(nominations, ["n1"], "f1")) {
      expect(Object.keys(row).sort()).toEqual(["count", "filmId", "nominationId", "winner"]);
    }
  });
});

describe("ratingsView (blind reveal)", () => {
  const ratings = [
    { membershipId: "a", value: "A's rating" },
    { membershipId: "b", value: "B's rating" },
  ];

  it("hidden until every attendee has rated", () => {
    expect(ratingsView(["a", "b", "c"], ratings)).toEqual({ revealed: false });
  });

  it("revealed once every attendee has rated", () => {
    expect(ratingsView(["a", "b"], ratings)).toEqual({ revealed: true, ratings });
  });

  it("nobody attended: nothing to reveal", () => {
    expect(ratingsView([], [])).toEqual({ revealed: true, ratings: [] });
  });
});
