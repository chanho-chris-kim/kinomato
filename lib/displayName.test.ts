import { describe, expect, it } from "vitest";
import {
  clashMessage,
  DISPLAY_NAME_MAX,
  findClash,
  nameKey,
  shownName,
  validateDisplayName,
  validateInviteeName,
} from "./displayName";

// Display name (ruled 2026-11-25, built u2): one free-text name, trimmed,
// 1–30 characters, unique within each club, case-insensitively, among
// active members.
describe("validateDisplayName", () => {
  it("trims and keeps what the person typed, nickname or not", () => {
    expect(validateDisplayName("  Ana A.  ")).toEqual({ displayName: "Ana A." });
    expect(validateDisplayName("DJ Spinz")).toEqual({ displayName: "DJ Spinz" });
    expect(validateDisplayName("Zoë")).toEqual({ displayName: "Zoë" });
  });

  it("runs of spaces inside become one", () => {
    expect(validateDisplayName("Ana    A.")).toEqual({ displayName: "Ana A." });
    expect(validateDisplayName("Ana\tA.")).toEqual({ displayName: "Ana A." });
  });

  it("1 to 30 characters, counted as people see them", () => {
    expect(validateDisplayName("x")).toEqual({ displayName: "x" });
    expect(validateDisplayName("x".repeat(DISPLAY_NAME_MAX))).toEqual({ displayName: "x".repeat(30) });
    expect(validateDisplayName("🎬".repeat(30))).toEqual({ displayName: "🎬".repeat(30) });
    expect(validateDisplayName("x".repeat(31))).toEqual({ error: "Keep your display name to 30 characters or fewer." });
  });

  it("empty, or only spaces, is refused", () => {
    for (const blank of ["", "   ", "\n"]) {
      expect(validateDisplayName(blank), JSON.stringify(blank)).toEqual({ error: "Enter a display name." });
    }
  });

  it("control characters are refused", () => {
    expect(validateDisplayName("Ana\u0000")).toEqual({ error: "That display name has characters we can't show." });
    expect(validateDisplayName("Ana\u0007B")).toEqual({ error: "That display name has characters we can't show." });
  });

  it("the names the app gives people who've left or not named themselves are reserved", () => {
    for (const reserved of ["Former member", "former MEMBER", "Unnamed member"]) {
      expect(validateDisplayName(reserved), reserved).toEqual({ error: "That name is reserved. Pick another." });
    }
  });
});

describe("nameKey", () => {
  it("compares trimmed, case-folded, with one space between words", () => {
    expect(nameKey("  Ana  A. ")).toBe(nameKey("ana a."));
    expect(nameKey("ÉLODIE")).toBe(nameKey("élodie"));
    expect(nameKey("Ana A.")).not.toBe(nameKey("Ana B."));
  });

  it("looks past full-width and compatibility forms", () => {
    expect(nameKey("ＡＮＡ")).toBe(nameKey("ana"));
  });
});

describe("findClash", () => {
  const clubs = [
    { clubName: "Saturday Club", names: ["Ben B.", "Cal C."] },
    { clubName: "Horror Sundays", names: ["Ana A.", "Dee"] },
  ];

  it("names the first club, in the order given, where someone already goes by it", () => {
    expect(findClash("ben b.", clubs)).toBe("Saturday Club");
    expect(findClash("  DEE ", clubs)).toBe("Horror Sundays");
    expect(findClash("Ana A.", [...clubs, { clubName: "Third", names: ["Ana A."] }])).toBe("Horror Sundays");
  });

  it("no clash: null", () => {
    expect(findClash("Eve E.", clubs)).toBeNull();
    expect(findClash("Ben", clubs)).toBeNull();
    expect(findClash("Ana A.", [])).toBeNull();
  });

  it("a member without a name yet never blocks anyone", () => {
    expect(findClash("Ana", [{ clubName: "X", names: [null, "Ben"] }])).toBeNull();
  });
});

describe("clashMessage", () => {
  it("says who and where, and asks for another", () => {
    // A name that ends in a full stop doesn't get a second one.
    expect(clashMessage("Saturday Club", "Ben B.")).toBe("Someone in Saturday Club already goes by Ben B. Pick another.");
    expect(clashMessage("Horror Sundays", "Dee")).toBe("Someone in Horror Sundays already goes by Dee. Pick another.");
  });
});

describe("shownName", () => {
  it("the display name, else \"Unnamed member\" until the name step", () => {
    expect(shownName("Ana A.")).toBe("Ana A.");
    expect(shownName(null)).toBe("Unnamed member");
    expect(shownName(undefined)).toBe("Unnamed member");
  });
});

// An invite's name only greets the person (ruled 2026-11-25): the same
// length rules, said about "their name".
describe("validateInviteeName", () => {
  it("trimmed, spaces made one, 1 to 30 characters", () => {
    expect(validateInviteeName("  Marco  ")).toEqual({ name: "Marco" });
    expect(validateInviteeName("Big   Al")).toEqual({ name: "Big Al" });
    expect(validateInviteeName("")).toEqual({ error: "Enter their name." });
    expect(validateInviteeName("x".repeat(31))).toEqual({ error: "Keep their name to 30 characters or fewer." });
    expect(validateInviteeName("A\u0000")).toEqual({ error: "That name has characters we can't show." });
  });
});
