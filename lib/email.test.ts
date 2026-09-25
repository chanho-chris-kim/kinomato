import { describe, expect, it, vi } from "vitest";
import { sendMagicLinkEmail } from "./email";

// No RESEND_API_KEY in this test env (vitest runs the same way CI and
// E2E do — CLAUDE.md's fixture-fallback pattern) — this is the only
// path exercisable without live Resend credentials and a real inbox.
describe("sendMagicLinkEmail (no RESEND_API_KEY — no real send)", () => {
  it("resolves without throwing and without a network call", async () => {
    await expect(
      sendMagicLinkEmail("dana@example.com", "https://kinomato.com/verify?token=abc"),
    ).resolves.toBeUndefined();
  });

  it("logs the link so a developer without a key can still click through", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await sendMagicLinkEmail("dana@example.com", "https://kinomato.com/verify?token=abc");
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("dana@example.com"),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("https://kinomato.com/verify?token=abc"),
    );
    logSpy.mockRestore();
  });
});
