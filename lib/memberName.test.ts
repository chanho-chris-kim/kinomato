import { describe, expect, it } from "vitest";
import { composeDisplayName, validateMemberName } from "./memberName";

describe("composeDisplayName", () => {
  it("joins first name and last initial with a trailing period", () => {
    expect(composeDisplayName("Chris", "K")).toBe("Chris K.");
  });
});

describe("validateMemberName", () => {
  it("accepts a normal first name and last initial", () => {
    expect(validateMemberName("Chris", "K")).toEqual({ displayName: "Chris K." });
  });

  it("strips surrounding whitespace from both fields", () => {
    expect(validateMemberName("  Chris  ", "  k  ")).toEqual({ displayName: "Chris K." });
  });

  it("normalizes the last initial to uppercase, so 'k' and 'K' can't become two people", () => {
    expect(validateMemberName("Priya", "s")).toEqual({ displayName: "Priya S." });
    expect(validateMemberName("Priya", "S")).toEqual({ displayName: "Priya S." });
  });

  it("preserves a multi-word first name", () => {
    expect(validateMemberName("Mary Jane", "S")).toEqual({ displayName: "Mary Jane S." });
  });

  it("rejects an empty first name", () => {
    expect(validateMemberName("", "K")).toEqual({ error: "First name is required." });
    expect(validateMemberName("   ", "K")).toEqual({ error: "First name is required." });
  });

  it("rejects an empty last initial", () => {
    expect(validateMemberName("Chris", "")).toEqual({
      error: "Last initial must be exactly one letter.",
    });
  });

  it("rejects a last initial longer than one letter", () => {
    expect(validateMemberName("Chris", "Ko")).toEqual({
      error: "Last initial must be exactly one letter.",
    });
  });

  it("rejects a last initial that isn't a letter", () => {
    expect(validateMemberName("Chris", "5")).toEqual({
      error: "Last initial must be exactly one letter.",
    });
    expect(validateMemberName("Chris", ".")).toEqual({
      error: "Last initial must be exactly one letter.",
    });
  });

  it("checks first name before last initial when both are invalid", () => {
    expect(validateMemberName("", "")).toEqual({ error: "First name is required." });
  });
});
