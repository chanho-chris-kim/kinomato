import { describe, expect, it } from "vitest";
import { orderNominations } from "./nominationOrder";

// The order the picker chose (ruled 2026-11-21): nominations.position,
// lock's last tiebreak, so with no votes the first choice wins.

describe("orderNominations", () => {
  it("follows the order the picker clicked", () => {
    expect(orderNominations(["a", "b", "c"], ["c", "a", "b"])).toEqual(["c", "a", "b"]);
  });

  it("falls back to the form's order for anything the click order doesn't name (no script)", () => {
    expect(orderNominations(["a", "b", "c"], [])).toEqual(["a", "b", "c"]);
    expect(orderNominations(["a", "b", "c"], ["b"])).toEqual(["b", "a", "c"]);
  });

  it("ignores an order entry that isn't a nominated film, and duplicates", () => {
    expect(orderNominations(["a", "b"], ["x", "b", "b", "a", "a"])).toEqual(["b", "a"]);
  });
});
