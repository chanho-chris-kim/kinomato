import { stepsLine } from "@/lib/steps";

// A step bar (the Tonight redesign, ruled 2026-11-25): Tonight's week, and
// an invited sign-up (§5.13). One list at every width: on phones a thin
// segment per step and one line of text, from 620px the labelled steps in a
// card. Done steps carry a tick, the current one aria-current="step".
// `className` lets a page keep its own hook (Tonight's ".weekbar").
export function StepBar({
  steps,
  current,
  label,
  className = "",
}: {
  steps: readonly string[];
  current: number;
  label: string;
  className?: string;
}) {
  return (
    <div className={`stepbar mt14 ${className}`.trim()}>
      <ol aria-label={label}>
        {steps.map((step, i) => {
          const state = i < current ? "done" : i === current ? "current" : "later";
          return (
            <li key={step} className={state} aria-current={i === current ? "step" : undefined}>
              <span className="weekbar-mark" aria-hidden="true">
                {i < current ? "✓" : i + 1}
              </span>
              <span className="weekbar-label">
                {step}
                {i < current && <span className="sr-only"> (done)</span>}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="weekbar-line small" aria-hidden="true">
        {stepsLine(steps, current)}
      </p>
    </div>
  );
}
