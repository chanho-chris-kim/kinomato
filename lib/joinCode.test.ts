import { describe, expect, it } from "vitest";
import { formatJoinCode, generateJoinCode, JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH, normaliseJoinCode } from "./joinCode";

describe("join codes", () => {
  it("the alphabet is Crockford base32: 32 symbols, no I, L, O or U", () => {
    expect(JOIN_CODE_ALPHABET).toHaveLength(32);
    expect(new Set(JOIN_CODE_ALPHABET).size).toBe(32);
    for (const c of "ILOU") expect(JOIN_CODE_ALPHABET).not.toContain(c);
  });

  it("generates 8 characters from the alphabet, from the random bytes given", () => {
    const code = generateJoinCode();
    expect(code).toHaveLength(JOIN_CODE_LENGTH);
    for (const c of code) expect(JOIN_CODE_ALPHABET).toContain(c);
    // Each byte picks one symbol by its low five bits: unbiased, 256 = 8 × 32.
    expect(generateJoinCode(() => new Uint8Array([0, 1, 31, 32, 33, 255, 10, 20]))).toBe("01Z01ZAM");
  });

  it("isn't the same twice (crypto randomness)", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateJoinCode()));
    expect(codes.size).toBe(200);
  });

  it("is shown as XXXX-XXXX", () => {
    expect(formatJoinCode("ABCD2345")).toBe("ABCD-2345");
  });

  it("reads input ignoring case, dashes and spaces", () => {
    expect(normaliseJoinCode("abcd-2345")).toBe("ABCD2345");
    expect(normaliseJoinCode("  ab cd 23 45 ")).toBe("ABCD2345");
    expect(normaliseJoinCode("ABCD—2345")).toBe("ABCD2345"); // an em dash, as phones type it
  });

  it("reads I and L as 1 and O as 0, as Crockford does", () => {
    expect(normaliseJoinCode("ILO0-2345")).toBe("1100" + "2345");
  });

  it("refuses anything else: wrong length, U, other symbols, nothing", () => {
    for (const bad of ["", "ABCD-234", "ABCD-23456", "ABCD-234U", "ABCD-23*5", null, undefined, 12345678]) {
      expect(normaliseJoinCode(bad), String(bad)).toBeNull();
    }
  });
});
