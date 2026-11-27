// "Start your club" (u4, §5.13): the new-club form, read by the same
// readers as the Members tab's edit forms (lib/clubDetails.ts,
// lib/clubSettings.ts), so the two can never disagree. Pure.

import { checkFirstNight, readClubDetailsForm, type ClubDetails } from "./clubDetails";
import {
  getAutoAdvance,
  getConfirmAt,
  getLockTime,
  getNomineesPerTurn,
  getShowVoteCounts,
  readClubSettingsForm,
} from "./clubSettings";
import { NEW_GETTING_STARTED } from "./gettingStarted";

// What the form is prefilled with: today's defaults, taken from the
// readers themselves so they can't drift.
export const NEW_CLUB_DEFAULTS = {
  cadence: "weekly" as const,
  defaultDay: 6,
  defaultTime: "20:00",
  mode: "in_person" as const,
  nomineesPerTurn: getNomineesPerTurn({}),
  lockTime: getLockTime({}),
  confirmAt: getConfirmAt({}),
  autoAdvance: getAutoAdvance({}),
  showVoteCounts: getShowVoteCounts({}),
};

export function readNewClubForm(
  fields: Record<string, unknown>,
  now: Date,
): { ok: true; details: ClubDetails; settings: Record<string, unknown> } | { ok: false; error: string } {
  // No fixed schedule isn't offered until nights can be scheduled by hand,
  // the same rule as editing (ruled 2026-11-10).
  const details = readClubDetailsForm(
    {
      name: fields.name,
      cadence: fields.cadence,
      defaultDay: fields.defaultDay,
      defaultTime: fields.defaultTime,
      timezone: fields.timezone,
      mode: fields.mode,
    },
    { allowAdHoc: false },
  );
  if (!details.ok) return details;
  const settings = readClubSettingsForm({
    nomineesPerTurn: fields.nomineesPerTurn,
    confirmAt: fields.confirmAt,
    lockTime: fields.lockTime,
    autoAdvance: fields.autoAdvance,
    showVoteCounts: fields.showVoteCounts,
  });
  if (!settings.ok) return settings;
  // Every other week and monthly count from a first night somebody chose
  // (ruled 2026-11-10), stored as the schedule's anchor.
  let anchor: { scheduleAnchor: string } | Record<string, never> = {};
  if (details.details.cadence === "biweekly" || details.details.cadence === "monthly") {
    const first = checkFirstNight(fields.firstNightOn, details.details, now);
    if (!first.ok) return first;
    anchor = { scheduleAnchor: first.date };
  }
  return {
    ok: true,
    details: details.details,
    settings: { ...settings.settings, ...anchor, gettingStarted: { ...NEW_GETTING_STARTED } },
  };
}
