import { StepBar } from "@/app/stepBar";
import { WEEK_STAGE_LABELS, WEEK_STAGES, type WeekStage } from "@/lib/tonight";

// The week bar (ruled 2026-11-25): Nominate → Vote → Locked → Watch → Rate,
// through the shared step bar (app/stepBar.tsx).
export function WeekBar({ stage }: { stage: WeekStage }) {
  return (
    <StepBar
      steps={WEEK_STAGES.map((s) => WEEK_STAGE_LABELS[s])}
      current={WEEK_STAGES.indexOf(stage)}
      label="This week's progress"
      className="weekbar"
    />
  );
}
