import { describe, expect, it } from "vitest";
import { firstNightWords, gettingStartedItems, readGettingStarted, showGettingStarted } from "./gettingStarted";

// "Get {club} going" on Tonight (u4): for the owner of a club started since
// u4, until it's done or hidden.
describe("readGettingStarted", () => {
  it("absent (a club from before u4): no list", () => {
    expect(readGettingStarted({})).toBeNull();
    expect(readGettingStarted(null)).toBeNull();
    expect(readGettingStarted({ nomineesPerTurn: 3 })).toBeNull();
  });
  it("reads what's stored", () => {
    expect(readGettingStarted({ gettingStarted: { checked: false, hidden: false } })).toEqual({ checked: false, hidden: false });
    expect(readGettingStarted({ gettingStarted: { checked: true, hidden: true } })).toEqual({ checked: true, hidden: true });
  });
  it("anything malformed fails loud: it's configuration, our bug", () => {
    for (const bad of [true, "yes", { checked: "true", hidden: false }, { checked: false }, { checked: false, hidden: false, extra: 1 }]) {
      expect(() => readGettingStarted({ gettingStarted: bad }), JSON.stringify(bad)).toThrow(/gettingStarted/);
    }
  });
});

describe("gettingStartedItems", () => {
  const base = { hasOtherPeople: false, ownFilms: 0, checked: false };
  it("create is done; the rest on their real conditions", () => {
    expect(gettingStartedItems(base).map((i) => [i.key, i.done])).toEqual([
      ["create", true],
      ["invite", false],
      ["films", false],
      ["check", false],
    ]);
    const done = gettingStartedItems({ hasOtherPeople: true, ownFilms: 3, checked: true });
    expect(done.every((i) => i.done)).toBe(true);
    expect(gettingStartedItems({ ...base, ownFilms: 2 })[2].done).toBe(false);
  });
});

describe("showGettingStarted", () => {
  const state = { checked: false, hidden: false };
  const items = gettingStartedItems({ hasOtherPeople: false, ownFilms: 0, checked: false });
  it("the owner, while it's incomplete and not hidden", () => {
    expect(showGettingStarted({ state, isOwner: true, items })).toBe(true);
    expect(showGettingStarted({ state, isOwner: false, items })).toBe(false);
    expect(showGettingStarted({ state: { ...state, hidden: true }, isOwner: true, items })).toBe(false);
    expect(showGettingStarted({ state: null, isOwner: true, items })).toBe(false);
    const all = gettingStartedItems({ hasOtherPeople: true, ownFilms: 3, checked: true });
    expect(showGettingStarted({ state, isOwner: true, items: all })).toBe(false);
  });
});

describe("firstNightWords", () => {
  it("the day and the time in the club's own zone, in the app's one time format", () => {
    // Sat 28 Nov 2026, 8pm in New York.
    expect(firstNightWords(new Date("2026-11-29T01:00:00Z"), "America/New_York")).toEqual({
      date: "Saturday, Nov 28",
      time: "8:00pm",
    });
    expect(firstNightWords(new Date("2026-11-29T01:00:00Z"), "Europe/London")).toEqual({
      date: "Sunday, Nov 29",
      time: "1:00am",
    });
  });
});
