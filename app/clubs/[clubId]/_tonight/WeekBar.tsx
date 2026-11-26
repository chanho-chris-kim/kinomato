import { stepLine, WEEK_STAGE_LABELS, WEEK_STAGES, type WeekStage } from "@/lib/tonight";

// The week bar (ruled 2026-11-25): Nominate → Vote → Locked → Watch → Rate.
// One list for every width: on phones a thin five-segment bar with one
// line of text, from 620px the five labelled steps in a card. Done steps
// carry a tick, the current one aria-current="step".
export function WeekBar({ stage }: { stage: WeekStage }) {
  const current = WEEK_STAGES.indexOf(stage);
  return (
    <div className="weekbar mt14">
      <ol aria-label="This week's progress">
        {WEEK_STAGES.map((s, i) => {
          const state = i < current ? "done" : i === current ? "current" : "later";
          return (
            <li key={s} className={state} aria-current={i === current ? "step" : undefined}>
              <span className="weekbar-mark" aria-hidden="true">
                {i < current ? "✓" : i + 1}
              </span>
              <span className="weekbar-label">
                {WEEK_STAGE_LABELS[s]}
                {i < current && <span className="sr-only"> (done)</span>}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="weekbar-line small" aria-hidden="true">
        {stepLine(stage)}
      </p>
    </div>
  );
}
