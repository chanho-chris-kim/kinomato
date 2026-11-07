import { describe, expect, it } from "vitest";
import { maskEmail, normaliseEmail } from "./emailAddress";

describe("normaliseEmail", () => {
  it("trims and lowercases", () => {
    expect(normaliseEmail("  Dana@Example.COM ")).toBe("dana@example.com");
  });
  it("leaves an already-normal address alone", () => {
    expect(normaliseEmail("dana@example.com")).toBe("dana@example.com");
  });
  it("an empty or whitespace input is empty", () => {
    expect(normaliseEmail("   ")).toBe("");
  });
});

describe("maskEmail", () => {
  it("keeps the first character and the domain", () => {
    expect(maskEmail("nadia@gmail.com")).toBe("n•••@gmail.com");
  });
  it("never shows more than one character of the local part, however short or long", () => {
    expect(maskEmail("a@x.org")).toBe("a•••@x.org");
    expect(maskEmail("averyveryverylongname@kinomato.com")).toBe("a•••@kinomato.com");
  });
  it("splits on the last @", () => {
    expect(maskEmail('"odd@local"@example.com')).toBe('"•••@example.com');
  });
  it("something that isn't an address reveals nothing", () => {
    expect(maskEmail("nobody")).toBe("•••");
    expect(maskEmail("@example.com")).toBe("•••@example.com");
  });
});
