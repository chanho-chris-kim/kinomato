import { afterEach, describe, expect, it, vi } from "vitest";
import * as email from "./email";
import { sendOpsAlert, sendSignInEmail } from "./email";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Amazon SES v2 in ca-central-1 (docs/onboarding-spec.md §9, ruled
// 2026-11-22). fetch is stubbed throughout: these pin the request shape
// against SES's documented SendEmail contract, never a live send.

const SES_URL = "https://email.ca-central-1.amazonaws.com/v2/email/outbound-emails";

// Test credentials, so a developer's shell env can never turn a test into a
// real send. Without them, the credentials are stubbed to "" (no send).
function withSes() {
  vi.stubEnv("SES_ACCESS_KEY_ID", "AKIDTEST");
  vi.stubEnv("SES_SECRET_ACCESS_KEY", "test-secret");
  vi.stubEnv("SES_REGION", "");
}
function withoutSes() {
  vi.stubEnv("SES_ACCESS_KEY_ID", "");
  vi.stubEnv("SES_SECRET_ACCESS_KEY", "");
}
function stubFetch(response = () => new Response('{"MessageId":"x"}', { status: 200 })) {
  const fetchSpy = vi.fn().mockImplementation(async () => response());
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}
const bodies = (fetchSpy: ReturnType<typeof vi.fn>) =>
  fetchSpy.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
const html = (body: { Content: { Simple: { Body: { Html: { Data: string } } } } }) => body.Content.Simple.Body.Html.Data;
const subject = (body: { Content: { Simple: { Subject: { Data: string } } } }) => body.Content.Simple.Subject.Data;

describe("sendSignInEmail without SES credentials (no real send)", () => {
  it("resolves without throwing and without a network call", async () => {
    withoutSes();
    const fetchSpy = stubFetch();
    vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(
      sendSignInEmail("dana@example.com", "048213", "https://kinomato.com/verify?token=abc"),
    ).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("logs the code and the link so a developer without credentials can still sign in", async () => {
    withoutSes();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await sendSignInEmail("dana@example.com", "048213", "https://kinomato.com/verify?token=abc");
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("dana@example.com"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("https://kinomato.com/verify?token=abc"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("048213"));
  });
});

describe("sendSignInEmail through SES", () => {
  it("POSTs SES v2 SendEmail in ca-central-1, signed with SigV4", async () => {
    withSes();
    const fetchSpy = stubFetch();
    await sendSignInEmail("dana@example.com", "048213", "https://kinomato.com/verify?token=abc");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(SES_URL);
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(init.headers["x-amz-date"]).toMatch(/^\d{8}T\d{6}Z$/);
    expect(init.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDTEST\/\d{8}\/ca-central-1\/ses\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    expect(JSON.stringify(init.headers)).not.toContain("test-secret");

    const [body] = bodies(fetchSpy);
    expect(body.FromEmailAddress).toBe("Kinomato <hello@kinomato.com>");
    expect(body.Destination).toEqual({ ToAddresses: ["dana@example.com"] });
    // The code leads the subject so it shows in the notification itself,
    // which is where iOS and Android pick up one-time codes to autofill.
    expect(subject(body)).toBe("048213 is your Kinomato sign-in code");
    expect(html(body)).toContain("048213");
    expect(html(body)).toContain("https://kinomato.com/verify?token=abc");
    expect(body.ReplyToAddresses).toBeUndefined();
  });

  it("SES_REGION moves the endpoint and the signature's region", async () => {
    withSes();
    vi.stubEnv("SES_REGION", "ca-west-1");
    const fetchSpy = stubFetch();
    await sendSignInEmail("dana@example.com", "048213", "https://kinomato.com/verify?token=abc");
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://email.ca-west-1.amazonaws.com/v2/email/outbound-emails");
    expect(init.headers.authorization).toContain("/ca-west-1/ses/aws4_request");
  });

  it("throws with SES's error message on a non-2xx response, without the recipient's address", async () => {
    withSes();
    stubFetch(() => new Response('{"message":"Email address is not verified."}', { status: 400 }));
    const error = await sendSignInEmail("dana@example.com", "048213", "https://kinomato.com/verify?token=abc").catch((e) => e);
    expect(String(error)).toMatch(/400.*Email address is not verified/);
    expect(String(error)).not.toContain("dana@example.com");
  });
});

// No tracking, by design (ruled 2026-11-22): SES can only add an open pixel
// or rewrite links through a configuration set. No email ever names one.
describe("no configuration set, ever", () => {
  it("in every email this module sends", async () => {
    withSes();
    vi.stubEnv("SUPPORT_EMAIL", "support@kinomato.com");
    const fetchSpy = stubFetch();
    await email.sendSignInEmail("a@example.com", "123456", "https://kinomato.com/verify?token=t");
    await email.sendInviteOnlyEmail("a@example.com");
    await email.sendEmailChangeCode("a@example.com", "123456");
    await email.sendEmailTakenNotice("a@example.com");
    await email.sendEmailChangedNotice("a@example.com", "b•••@example.com");
    await email.sendAccountDeletionCode("a@example.com", "123456");
    await email.sendAccountDeletedReceipt("a@example.com");
    await email.sendOpsAlert("weekly-loop", new Date(), { failed: 1 });

    expect(fetchSpy).toHaveBeenCalledTimes(8);
    for (const [, init] of fetchSpy.mock.calls) {
      const raw = (init as RequestInit).body as string;
      expect(raw).not.toMatch(/ConfigurationSet/i);
      expect(Object.keys(JSON.parse(raw)).sort()).toEqual(
        expect.not.arrayContaining(["ConfigurationSetName"]),
      );
    }
  });
});

describe("credentials", () => {
  it("half a configuration fails loud", async () => {
    vi.stubEnv("SES_ACCESS_KEY_ID", "AKIDTEST");
    vi.stubEnv("SES_SECRET_ACCESS_KEY", "");
    const fetchSpy = stubFetch();
    await expect(email.sendInviteOnlyEmail("a@example.com")).rejects.toThrow(/Only one of SES_ACCESS_KEY_ID/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("none in production fails loud (the AUTH_SECRET posture)", async () => {
    withoutSes();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EMAIL_OUTBOX_FILE", "");
    const fetchSpy = stubFetch();
    await expect(email.sendInviteOnlyEmail("a@example.com")).rejects.toThrow(/SES_ACCESS_KEY_ID and SES_SECRET_ACCESS_KEY are not set/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("none on Playwright's production-build server (it sets the outbox): the outbox, no send", async () => {
    const { mkdtempSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const file = join(mkdtempSync(join(tmpdir(), "outbox-")), "outbox.jsonl");
    withoutSes();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EMAIL_OUTBOX_FILE", file);
    const fetchSpy = stubFetch();
    vi.spyOn(console, "log").mockImplementation(() => {});
    await email.sendInviteOnlyEmail("a@example.com");
    expect(readFileSync(file, "utf8")).toContain('"kind":"invite-only"');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// Email change (docs/onboarding-spec.md §5.9; rebuild step 7b).
describe("email-change emails", () => {
  it("the code goes to the new address, and only there; no link", async () => {
    withSes();
    const fetchSpy = stubFetch();
    await email.sendEmailChangeCode("new@example.com", "246810");
    const [body] = bodies(fetchSpy);
    expect(body.Destination).toEqual({ ToAddresses: ["new@example.com"] });
    expect(subject(body)).toContain("246810");
    expect(html(body)).toContain("246810");
    expect(html(body)).not.toContain("href");
  });

  it("the taken-address notice carries no code", async () => {
    withSes();
    const fetchSpy = stubFetch();
    await email.sendEmailTakenNotice("taken@example.com");
    const [body] = bodies(fetchSpy);
    expect(body.Destination).toEqual({ ToAddresses: ["taken@example.com"] });
    expect(html(body)).toContain("You already have one, so nothing changed.");
    expect(html(body)).not.toMatch(/\d{6}/);
  });

  it("the old-address notice shows only the masked new address, with Reply-To from SUPPORT_EMAIL", async () => {
    withSes();
    vi.stubEnv("SUPPORT_EMAIL", "support@kinomato.com");
    const fetchSpy = stubFetch();
    await email.sendEmailChangedNotice("old@example.com", "n•••@gmail.com");
    const [body] = bodies(fetchSpy);
    expect(body.Destination).toEqual({ ToAddresses: ["old@example.com"] });
    expect(body.ReplyToAddresses).toEqual(["support@kinomato.com"]);
    expect(html(body)).toContain("Your Kinomato email was changed to n•••@gmail.com.");
    expect(html(body)).toContain("If this wasn't you, reply to this email.");
  });

  it("SUPPORT_EMAIL unset: throws a clear error and sends nothing", async () => {
    withSes();
    vi.stubEnv("SUPPORT_EMAIL", "");
    const fetchSpy = stubFetch();
    await expect(email.sendEmailChangedNotice("old@example.com", "n•••@gmail.com")).rejects.toThrow(/SUPPORT_EMAIL is not set/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("without credentials, a test outbox file (if set) records the message, and nothing is fetched", async () => {
    const { mkdtempSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const file = join(mkdtempSync(join(tmpdir(), "outbox-")), "outbox.jsonl");
    withoutSes();
    vi.stubEnv("EMAIL_OUTBOX_FILE", file);
    vi.stubEnv("SUPPORT_EMAIL", "support@kinomato.com");
    const fetchSpy = stubFetch();
    vi.spyOn(console, "log").mockImplementation(() => {});
    await email.sendEmailChangedNotice("old@example.com", "n•••@gmail.com");
    const [line] = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(line).toMatchObject({ kind: "email-changed-notice", to: "old@example.com", replyTo: "support@kinomato.com" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("with credentials, the outbox is never written", async () => {
    const { existsSync } = await import("node:fs");
    withSes();
    vi.stubEnv("EMAIL_OUTBOX_FILE", "/nonexistent-dir/should-not-be-written.jsonl");
    stubFetch();
    await email.sendEmailTakenNotice("taken@example.com");
    expect(existsSync("/nonexistent-dir/should-not-be-written.jsonl")).toBe(false);
  });
});

// A failed scheduled job (app/scheduledJobs.ts): to SUPPORT_EMAIL, the job,
// the time and the counts, and nothing else.
describe("sendOpsAlert", () => {
  const sent = () => {
    const fetchSpy = stubFetch();
    return () => bodies(fetchSpy)[0];
  };

  it("goes to SUPPORT_EMAIL with the job, the time, the counts and where to look", async () => {
    withSes();
    vi.stubEnv("SUPPORT_EMAIL", "ops@kinomato.test");
    const body = sent();
    await sendOpsAlert("weekly-loop", new Date("2026-11-21T10:00:00Z"), { locked: 2, unconfirmed: 0, passed: 1, failed: 1 });
    expect(body().Destination).toEqual({ ToAddresses: ["ops@kinomato.test"] });
    expect(subject(body())).toBe("Kinomato: the weekly-loop job failed");
    expect(html(body())).toContain("2026-11-21T10:00:00.000Z");
    expect(html(body())).toContain("Counts: locked 2, unconfirmed 0, passed 1, failed 1.");
    expect(html(body())).toContain("See Workers Logs");
  });

  it("with no counts (a run that stopped early), says so", async () => {
    withSes();
    vi.stubEnv("SUPPORT_EMAIL", "ops@kinomato.test");
    const body = sent();
    await sendOpsAlert("retention", new Date("2026-11-21T10:00:00Z"), null);
    expect(html(body())).toContain("Counts: none: it stopped before finishing.");
  });

  it("drops anything in counts that isn't a plain name and a number", async () => {
    withSes();
    vi.stubEnv("SUPPORT_EMAIL", "ops@kinomato.test");
    const body = sent();
    const sneaky = { locked: 1, "dana@example.com": 3, note: Number.NaN } as Record<string, number>;
    await sendOpsAlert("weekly-loop", new Date("2026-11-21T10:00:00Z"), sneaky);
    expect(html(body())).toContain("Counts: locked 1.");
    expect(html(body())).not.toContain("dana");
  });

  it("fails loud when SUPPORT_EMAIL is unset", async () => {
    withSes();
    vi.stubEnv("SUPPORT_EMAIL", "");
    sent();
    await expect(sendOpsAlert("weekly-loop", new Date(), null)).rejects.toThrow(/SUPPORT_EMAIL is not set/);
  });
});
