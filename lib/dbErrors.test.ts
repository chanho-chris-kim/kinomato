import { describe, expect, it } from "vitest";
import { isUniqueViolation } from "./dbErrors";

// "A club has at most one night in flight" is a partial unique index: a
// second concurrent draft is a rejected insert, Postgres code 23505. A batch
// (neon-http) may report the code on the error's cause.
describe("isUniqueViolation", () => {
  it("is 23505, on the error or its cause", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation(Object.assign(new Error("batch failed"), { cause: { code: "23505" } }))).toBe(true);
  });

  it("anything else isn't", () => {
    for (const e of [{ code: "23503" }, new Error("23505"), { cause: { code: "40001" } }, null, undefined, "23505", 23505]) {
      expect(isUniqueViolation(e), String(e)).toBe(false);
    }
  });
});
