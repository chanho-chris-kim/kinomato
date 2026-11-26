import { describe, expect, it } from "vitest";
import { resendWaitText, SIGN_UP_STEPS, stepsLine } from "./steps";

// The step bar's one line on phones (Tonight's week, and invited sign-up).
describe("stepsLine", () => {
  it("names the step and what comes after", () => {
    expect(stepsLine(SIGN_UP_STEPS, 0)).toBe("Step 1 of 3 · Email · then Code, About you");
    expect(stepsLine(SIGN_UP_STEPS, 1)).toBe("Step 2 of 3 · Code · then About you");
    expect(stepsLine(SIGN_UP_STEPS, 2)).toBe("Step 3 of 3 · About you");
  });
});

// The code screen's Resend countdown (u3), from the server's real wait.
describe("resendWaitText", () => {
  it("seconds under a minute, else whole minutes rounded up; nothing once it's allowed", () => {
    expect(resendWaitText(30)).toBe("30 seconds");
    expect(resendWaitText(1)).toBe("1 second");
    expect(resendWaitText(60)).toBe("1 minute");
    expect(resendWaitText(61)).toBe("2 minutes");
    expect(resendWaitText(0)).toBeNull();
    expect(resendWaitText(-3)).toBeNull();
  });
});
