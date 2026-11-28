import { describe, expect, it } from "vitest";
import { privacySummary, remindersSummary } from "./settingsSummary";

describe("the Settings menu's values (u7)", () => {
  it("Reminders: on or off, and how many clubs are muted", () => {
    expect(remindersSummary(true, 0)).toBe("On");
    expect(remindersSummary(true, 1)).toBe("On · 1 club muted");
    expect(remindersSummary(true, 3)).toBe("On · 3 clubs muted");
    // Off is off for every club, whatever is muted.
    expect(remindersSummary(false, 2)).toBe("Off");
  });

  it("Privacy & data: sharing or not, and the download; 13–17 have no sharing to show", () => {
    expect(privacySummary(false)).toBe("Not sharing · download your data");
    expect(privacySummary(true)).toBe("Sharing · download your data");
    expect(privacySummary(null)).toBe("Download your data");
  });
});
