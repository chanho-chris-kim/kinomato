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
