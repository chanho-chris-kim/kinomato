import { describe, expect, it } from "vitest";
import { resolveSeenFrom } from "./seenFrom";

const APPLE = { id: "c-apple", name: "Apple Club" };
const BIRCH = { id: "c-birch", name: "Birch Club" };
const OTHER = "c-not-mine";

describe("resolveSeenFrom (§6.4)", () => {
  it("no clubs: nothing to see from, no chips", () => {
    expect(resolveSeenFrom({ clubs: [], seenParam: APPLE.id, cookie: APPLE.id })).toEqual({
      club: null,
      showChips: false,
    });
  });

  it("one club: that club, implicitly, no chips", () => {
    expect(resolveSeenFrom({ clubs: [BIRCH], seenParam: undefined, cookie: undefined })).toEqual({
      club: BIRCH,
      showChips: false,
    });
  });

  it("one club ignores a param or cookie for any other club", () => {
    expect(resolveSeenFrom({ clubs: [BIRCH], seenParam: OTHER, cookie: OTHER }).club).toEqual(BIRCH);
  });

  it("several clubs, nothing chosen: the first by name, with chips", () => {
    expect(resolveSeenFrom({ clubs: [BIRCH, APPLE], seenParam: undefined, cookie: undefined })).toEqual({
      club: APPLE,
      showChips: true,
    });
  });

  it("the saved cookie choice, when it's one of your clubs", () => {
    expect(resolveSeenFrom({ clubs: [APPLE, BIRCH], seenParam: undefined, cookie: BIRCH.id }).club).toEqual(BIRCH);
  });

  it("?seen= presets this visit, ahead of the cookie", () => {
    expect(resolveSeenFrom({ clubs: [APPLE, BIRCH], seenParam: APPLE.id, cookie: BIRCH.id }).club).toEqual(APPLE);
  });

  it("a ?seen= club you're not in is ignored: the cookie, else the default", () => {
    expect(resolveSeenFrom({ clubs: [APPLE, BIRCH], seenParam: OTHER, cookie: BIRCH.id }).club).toEqual(BIRCH);
    expect(resolveSeenFrom({ clubs: [APPLE, BIRCH], seenParam: OTHER, cookie: undefined }).club).toEqual(APPLE);
  });

  it("a cookie for a club you're not in (forged, or one you left) is treated as unset", () => {
    expect(resolveSeenFrom({ clubs: [APPLE, BIRCH], seenParam: undefined, cookie: OTHER }).club).toEqual(APPLE);
  });

  it("garbage in either is ignored, never an error", () => {
    expect(resolveSeenFrom({ clubs: [APPLE, BIRCH], seenParam: "", cookie: "%%%" }).club).toEqual(APPLE);
  });
});
