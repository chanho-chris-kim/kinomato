// The values the Settings menu shows beside each row (u7, ruled
// 2026-11-27). Pure.

// "On", "On · 1 club muted", "Off": the main switch, then the per-club
// mutes it leaves in force.
export function remindersSummary(emailReminders: boolean, mutedClubs: number): string {
  if (!emailReminders) return "Off";
  if (mutedClubs === 0) return "On";
  return `On · ${mutedClubs} ${mutedClubs === 1 ? "club" : "clubs"} muted`;
}

// `sharing`: null for 13–17, who never see data sharing (§11.2).
export function privacySummary(sharing: boolean | null): string {
  if (sharing === null) return "Download your data";
  return `${sharing ? "Sharing" : "Not sharing"} · download your data`;
}
