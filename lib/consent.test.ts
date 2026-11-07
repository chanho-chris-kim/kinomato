import { describe, expect, it } from "vitest";
import {
  acceptanceMethod,
  canOptInToLicensing,
  currentLicensing,
  isLicensingActive,
  needsConsent,
  parseAgeChoice,
  readConsentForm,
} from "./consent";
import { LEGAL } from "./legal";

const day = (n: number) => new Date(Date.UTC(2026, 10, n, 12));
const accepted = (document: "terms" | "privacy", version: string, n: number) => ({
  document,
  version,
  acceptedAt: day(n),
});
const current = [accepted("terms", LEGAL.terms.version, 6), accepted("privacy", LEGAL.privacy.version, 6)];
const adult = { ageBracket: "18_plus" as const };

describe("needsConsent", () => {
  it("is empty when both current versions are accepted and age is known", () => {
    expect(needsConsent(adult, current, LEGAL)).toEqual([]);
    expect(needsConsent({ ageBracket: "13_17" }, current, LEGAL)).toEqual([]);
  });

  it("asks for everything on an account that has never been asked", () => {
    expect(needsConsent({ ageBracket: null }, [], LEGAL)).toEqual(["terms", "privacy", "age"]);
  });

  it("asks for age alone on an account that accepted but was never asked its age", () => {
    expect(needsConsent({ ageBracket: null }, current, LEGAL)).toEqual(["age"]);
  });

  it("flags only the document whose version changed", () => {
    const bumped = { ...LEGAL, terms: { ...LEGAL.terms, version: "2099-01-01" } };
    expect(needsConsent(adult, current, bumped)).toEqual(["terms"]);
  });

  it("reads each document's newest row, not any matching row", () => {
    // Accepted the current version, then (somehow) an older one later: the
    // newest row is what counts.
    const events = [
      accepted("terms", LEGAL.terms.version, 6),
      accepted("terms", "2020-01-01", 7),
      accepted("privacy", LEGAL.privacy.version, 6),
    ];
    expect(needsConsent(adult, events, LEGAL)).toEqual(["terms"]);
  });

  it("is satisfied by a re-acceptance after an old one, in any row order", () => {
    const events = [
      accepted("privacy", LEGAL.privacy.version, 9),
      accepted("terms", LEGAL.terms.version, 9),
      accepted("terms", "2020-01-01", 1),
      accepted("privacy", "2020-01-01", 1),
    ];
    expect(needsConsent(adult, events, LEGAL)).toEqual([]);
  });
});

describe("acceptanceMethod", () => {
  it("is signup for a first-ever acceptance and reconsent after any earlier one", () => {
    expect(acceptanceMethod([], "terms")).toBe("signup");
    expect(acceptanceMethod([accepted("privacy", "2020-01-01", 1)], "terms")).toBe("signup");
    expect(acceptanceMethod([accepted("terms", "2020-01-01", 1)], "terms")).toBe("reconsent");
  });
});

describe("parseAgeChoice", () => {
  it("knows the three options and nothing else", () => {
    expect(parseAgeChoice("13_17")).toBe("13_17");
    expect(parseAgeChoice("18_plus")).toBe("18_plus");
    expect(parseAgeChoice("under_13")).toBe("under_13");
    expect(parseAgeChoice("")).toBeNull();
    expect(parseAgeChoice("21")).toBeNull();
    expect(parseAgeChoice(null)).toBeNull();
  });
});

describe("canOptInToLicensing", () => {
  it("is 18 or older only", () => {
    expect(canOptInToLicensing("18_plus")).toBe(true);
    expect(canOptInToLicensing("13_17")).toBe(false);
    expect(canOptInToLicensing(null)).toBe(false);
  });
});

const opt = (n: number, withdrawn: number | null, wordingVersion = LEGAL.licensing.version) => ({
  wordingVersion,
  optedInAt: day(n),
  withdrawnAt: withdrawn === null ? null : day(withdrawn),
});

describe("currentLicensing", () => {
  it("is never opted in with no rows", () => {
    expect(currentLicensing([])).toEqual({ optedIn: false, wordingVersion: null, since: null, withdrawnAt: null });
  });

  it("is the newest row: open means opted in", () => {
    expect(currentLicensing([opt(3, null)])).toEqual({
      optedIn: true,
      wordingVersion: LEGAL.licensing.version,
      since: day(3),
      withdrawnAt: null,
    });
  });

  it("a withdrawn newest row is out, with when", () => {
    expect(currentLicensing([opt(3, null), opt(5, 8)].reverse())).toMatchObject({
      optedIn: false,
      since: day(5),
      withdrawnAt: day(8),
    });
  });

  it("opting back in after a withdrawal is in again", () => {
    expect(currentLicensing([opt(1, 2), opt(4, null)])).toMatchObject({ optedIn: true, since: day(4) });
  });
});

describe("isLicensingActive", () => {
  it("needs an open row on the current wording, and 18 or older", () => {
    expect(isLicensingActive([opt(1, null)], "18_plus", LEGAL.licensing.version)).toBe(true);
    expect(isLicensingActive([opt(1, 2)], "18_plus", LEGAL.licensing.version)).toBe(false);
    expect(isLicensingActive([], "18_plus", LEGAL.licensing.version)).toBe(false);
    // Agreeing to one wording isn't agreeing to the next.
    expect(isLicensingActive([opt(1, null, "2020-01-01")], "18_plus", LEGAL.licensing.version)).toBe(false);
    // A row that should never exist still never counts for a 13–17.
    expect(isLicensingActive([opt(1, null)], "13_17", LEGAL.licensing.version)).toBe(false);
    expect(isLicensingActive([opt(1, null)], null, LEGAL.licensing.version)).toBe(false);
  });
});

describe("readConsentForm", () => {
  const both = { age: true, terms: true };

  it("needs an age when asked, and the Terms box", () => {
    expect(readConsentForm({ terms: "on" }, both)).toEqual({ kind: "error", error: "Choose your age." });
    expect(readConsentForm({ age: "18_plus" }, both)).toEqual({
      kind: "error",
      error: "To use Kinomato, agree to the Terms and the Privacy policy.",
    });
    expect(readConsentForm({ age: "18_plus", terms: "on", licensing: "on" }, both)).toEqual({
      kind: "ok",
      age: "18_plus",
      licensing: true,
    });
  });

  it("is under 13 before anything else, Terms box or not", () => {
    expect(readConsentForm({ age: "under_13" }, both)).toEqual({ kind: "under_13" });
    expect(readConsentForm({ age: "under_13", terms: "on", licensing: "on" }, both)).toEqual({ kind: "under_13" });
  });

  it("ignores an age it didn't ask for", () => {
    expect(readConsentForm({ age: "under_13", terms: "on" }, { age: false, terms: true })).toEqual({ kind: "ok", age: null, licensing: false });
  });

  it("doesn't need the Terms box when only the age was asked", () => {
    expect(readConsentForm({ age: "13_17" }, { age: true, terms: false })).toEqual({
      kind: "ok",
      age: "13_17",
      licensing: false,
    });
  });

  it("passes a ticked licensing box through as sent; who may opt in is decided on write", () => {
    expect(readConsentForm({ age: "13_17", terms: "on", licensing: "on" }, both)).toEqual({
      kind: "ok",
      age: "13_17",
      licensing: true,
    });
  });
});
