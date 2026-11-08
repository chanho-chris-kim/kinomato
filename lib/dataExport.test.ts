import { describe, expect, it } from "vitest";
import { EXPORT_FORMAT_VERSION, exportFilename, findSecretLikeKeys, shapeExport, type ExportInput } from "./dataExport";

const at = (d: string) => new Date(`${d}T12:00:00Z`);

const input: ExportInput = {
  account: {
    email: "kit@example.com",
    displayName: "Kit K.",
    createdAt: at("2026-01-01"),
    ageBracket: "18_plus",
    ageAttestedAt: at("2026-01-02"),
  },
  consentEvents: [
    { document: "terms", version: "2026-11-06", acceptedAt: at("2026-11-06"), method: "signup" },
  ],
  licensing: [{ wordingVersion: "2026-11-06", optedInAt: at("2026-11-06"), withdrawnAt: null }],
  clubs: [
    { name: "B Club", role: "member", joinedAt: at("2026-02-01"), leftAt: at("2026-03-01") },
    { name: "A Club", role: "owner", joinedAt: at("2026-01-01"), leftAt: null },
  ],
  watchlist: [{ title: "Arrival", year: 2016, addedAt: at("2026-04-01"), note: null, tags: ["sci-fi"] }],
  ratings: [
    {
      clubName: "A Club",
      filmTitle: "Arrival",
      nightAt: at("2026-05-01"),
      scoreQuality: "8.0",
      scoreFun: "7.5",
      hotTake: "Heady",
      tags: ["Slow Burn"],
    },
  ],
  nominations: [{ clubName: "A Club", filmTitle: "Arrival", nightAt: at("2026-05-01") }],
  rsvps: [{ clubName: "A Club", nightAt: at("2026-05-01"), status: "yes" }],
  constraints: [
    { clubName: "A Club", kind: "hard", ruleType: "genre", value: "27", label: "Horror", appliesWhenAbsent: false },
  ],
  votes: [{ clubName: "A Club", nightAt: at("2026-05-01"), filmTitle: "Arrival", castAt: at("2026-04-30") }],
  vetoes: [],
  emailChanges: [
    { newEmail: "kit2@example.com", requestedAt: at("2026-06-01"), confirmedAt: null, cancelledAt: at("2026-06-02") },
  ],
};

describe("exportFilename", () => {
  it("is kinomato-export-YYYY-MM-DD.json, by UTC date", () => {
    expect(exportFilename(new Date("2026-11-07T23:30:00Z"))).toBe("kinomato-export-2026-11-07.json");
    expect(exportFilename(new Date("2026-01-05T00:00:00Z"))).toBe("kinomato-export-2026-01-05.json");
  });
});

describe("shapeExport", () => {
  const now = new Date("2026-11-07T10:00:00Z");
  const out = shapeExport(input, now);

  it("leads with the format version and when it was made", () => {
    expect(out.meta).toEqual({ format_version: EXPORT_FORMAT_VERSION, generated_at: "2026-11-07T10:00:00.000Z" });
  });

  it("writes dates as ISO strings and keeps nulls", () => {
    expect(out.account).toEqual({
      email: "kit@example.com",
      display_name: "Kit K.",
      created_at: "2026-01-01T12:00:00.000Z",
      age_bracket: "18_plus",
      age_attested_at: "2026-01-02T12:00:00.000Z",
    });
    expect(out.clubs.find((c) => c.name === "A Club")?.left_at).toBeNull();
    expect(out.email_change_requests).toEqual([
      {
        new_email: "kit2@example.com",
        requested_at: "2026-06-01T12:00:00.000Z",
        confirmed_at: null,
        cancelled_at: "2026-06-02T12:00:00.000Z",
      },
    ]);
  });

  it("orders each list by its date, oldest first", () => {
    expect(out.clubs.map((c) => c.name)).toEqual(["A Club", "B Club"]);
  });

  it("has every section, and votes are the film you chose, nothing about anyone else", () => {
    expect(Object.keys(out)).toEqual([
      "meta",
      "account",
      "consent",
      "clubs",
      "watchlist",
      "ratings",
      "nominations",
      "rsvps",
      "limits_and_preferences",
      "votes",
      "vetoes",
      "email_change_requests",
    ]);
    expect(out.consent.data_licensing).toEqual([
      { wording_version: "2026-11-06", opted_in_at: "2026-11-06T12:00:00.000Z", withdrawn_at: null },
    ]);
    expect(out.votes).toEqual([
      { club: "A Club", night: "2026-05-01T12:00:00.000Z", film: "Arrival", cast_at: "2026-04-30T12:00:00.000Z" },
    ]);
  });

  it("copies only the fields it names: an extra column on a row never reaches the file", () => {
    const leaky = {
      ...input,
      account: { ...input.account, tokenHash: "abc" } as unknown as ExportInput["account"],
      emailChanges: [{ ...input.emailChanges[0], codeHash: "def" }] as unknown as ExportInput["emailChanges"],
    };
    const json = JSON.stringify(shapeExport(leaky, now));
    expect(json).not.toContain("abc");
    expect(json).not.toContain("def");
    expect(findSecretLikeKeys(shapeExport(leaky, now))).toEqual([]);
  });
});

describe("findSecretLikeKeys", () => {
  it("finds hash, token and code keys at any depth", () => {
    expect(findSecretLikeKeys({ a: 1, b: [{ code_hash: "x" }], c: { sessionToken: "y" }, code: "z" })).toEqual([
      "b.0.code_hash",
      "c.sessionToken",
      "code",
    ]);
    expect(findSecretLikeKeys({ account: { email: "a@b.c" }, ratings: [] })).toEqual([]);
  });
});
