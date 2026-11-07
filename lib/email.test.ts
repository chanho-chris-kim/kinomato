import { afterEach, describe, expect, it, vi } from "vitest";
import { sendSignInEmail } from "./email";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// No BREVO_API_KEY in this test env (vitest runs the same way CI and
// E2E do — CLAUDE.md's fixture-fallback pattern). Stubbed to "" rather
// than trusted to be unset, so a developer's shell env can't turn this
// into a real send.
describe("sendSignInEmail (no BREVO_API_KEY — no real send)", () => {
  it("resolves without throwing and without a network call", async () => {
    vi.stubEnv("BREVO_API_KEY", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(
      sendSignInEmail("dana@example.com", "048213", "https://kinomato.com/verify?token=abc"),
    ).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("logs the code and the link so a developer without a key can still sign in", async () => {
    vi.stubEnv("BREVO_API_KEY", "");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await sendSignInEmail("dana@example.com", "048213", "https://kinomato.com/verify?token=abc");
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("dana@example.com"),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("https://kinomato.com/verify?token=abc"),
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("048213"));
  });
});

// fetch is stubbed — this pins the request shape against Brevo's
// documented contract, not a live send.
describe("sendSignInEmail (BREVO_API_KEY set)", () => {
  it("POSTs to Brevo's transactional endpoint with an api-key header", async () => {
    vi.stubEnv("BREVO_API_KEY", "test-key");
    const fetchSpy = vi.fn().mockResolvedValue(new Response('{"messageId":"x"}', { status: 201 }));
    vi.stubGlobal("fetch", fetchSpy);

    await sendSignInEmail("dana@example.com", "048213", "https://kinomato.com/verify?token=abc");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(init.method).toBe("POST");
    expect(init.headers["api-key"]).toBe("test-key");
    expect(init.headers["content-type"]).toBe("application/json");
    const body = JSON.parse(init.body);
    expect(body.sender).toEqual({ email: "hello@kinomato.com", name: "Kinomato" });
    expect(body.to).toEqual([{ email: "dana@example.com" }]);
    // The code leads the subject so it shows in the notification itself,
    // which is where iOS and Android pick up one-time codes to autofill.
    expect(body.subject).toBe("048213 is your Kinomato sign-in code");
    expect(body.htmlContent).toContain("048213");
    expect(body.htmlContent).toContain("https://kinomato.com/verify?token=abc");
  });

  it("throws with Brevo's error message on a non-2xx response", async () => {
    vi.stubEnv("BREVO_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response('{"code":"unauthorized","message":"Key not found"}', { status: 401 }),
      ),
    );

    await expect(
      sendSignInEmail("dana@example.com", "048213", "https://kinomato.com/verify?token=abc"),
    ).rejects.toThrow(/401.*Key not found/);
  });
});

// Email change (docs/onboarding-spec.md §5.9; rebuild step 7b).
describe("email-change emails", () => {
  const sentBodies = (fetchSpy: ReturnType<typeof vi.fn>) =>
    fetchSpy.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));

  it("the code goes to the new address, and only there; no link", async () => {
    vi.stubEnv("BREVO_API_KEY", "test-key");
    const fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailChangeCode } = await import("./email");
    await sendEmailChangeCode("new@example.com", "246810");
    const [body] = sentBodies(fetchSpy);
    expect(body.to).toEqual([{ email: "new@example.com" }]);
    expect(body.subject).toContain("246810");
    expect(body.htmlContent).toContain("246810");
    expect(body.htmlContent).not.toContain("href");
  });

  it("the taken-address notice carries no code", async () => {
    vi.stubEnv("BREVO_API_KEY", "test-key");
    const fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailTakenNotice } = await import("./email");
    await sendEmailTakenNotice("taken@example.com");
    const [body] = sentBodies(fetchSpy);
    expect(body.to).toEqual([{ email: "taken@example.com" }]);
    expect(body.htmlContent).toContain("You already have one, so nothing changed.");
    expect(body.htmlContent).not.toMatch(/\d{6}/);
  });

  it("the old-address notice shows only the masked new address, with Reply-To from SUPPORT_EMAIL", async () => {
    vi.stubEnv("BREVO_API_KEY", "test-key");
    vi.stubEnv("SUPPORT_EMAIL", "support@kinomato.com");
    const fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailChangedNotice } = await import("./email");
    await sendEmailChangedNotice("old@example.com", "n•••@gmail.com");
    const [body] = sentBodies(fetchSpy);
    expect(body.to).toEqual([{ email: "old@example.com" }]);
    expect(body.replyTo).toEqual({ email: "support@kinomato.com" });
    expect(body.htmlContent).toContain("Your Kinomato email was changed to n•••@gmail.com.");
    expect(body.htmlContent).toContain("If this wasn't you, reply to this email.");
  });

  it("SUPPORT_EMAIL unset: throws a clear error and sends nothing", async () => {
    vi.stubEnv("BREVO_API_KEY", "test-key");
    vi.stubEnv("SUPPORT_EMAIL", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { sendEmailChangedNotice } = await import("./email");
    await expect(sendEmailChangedNotice("old@example.com", "n•••@gmail.com")).rejects.toThrow(/SUPPORT_EMAIL is not set/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("without a key, a test outbox file (if set) records the message, and nothing is fetched", async () => {
    const { mkdtempSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const file = join(mkdtempSync(join(tmpdir(), "outbox-")), "outbox.jsonl");
    vi.stubEnv("BREVO_API_KEY", "");
    vi.stubEnv("EMAIL_OUTBOX_FILE", file);
    vi.stubEnv("SUPPORT_EMAIL", "support@kinomato.com");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { sendEmailChangedNotice } = await import("./email");
    await sendEmailChangedNotice("old@example.com", "n•••@gmail.com");
    const [line] = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(line).toMatchObject({ kind: "email-changed-notice", to: "old@example.com", replyTo: "support@kinomato.com" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("with a key, the outbox is never written", async () => {
    const { existsSync } = await import("node:fs");
    vi.stubEnv("BREVO_API_KEY", "test-key");
    vi.stubEnv("EMAIL_OUTBOX_FILE", "/nonexistent-dir/should-not-be-written.jsonl");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 201 })));
    const { sendEmailTakenNotice } = await import("./email");
    await sendEmailTakenNotice("taken@example.com");
    expect(existsSync("/nonexistent-dir/should-not-be-written.jsonl")).toBe(false);
  });
});
