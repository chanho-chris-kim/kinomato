"use client";

import { useId, useState } from "react";

// The second client component in this codebase, after
// NominationSelector: the value shown beside the label follows the slider
// as it moves, which needs local state. Since the Tonight redesign
// (2026-11-25) it's one slider per score, with no number box beside it.
// The server action still validates the submitted value independently
// (never trusting what the client sent), so this component's only job is
// the live display.
export function RatingSlider({
  name,
  label,
  defaultValue = 5,
}: {
  name: string;
  label: string;
  defaultValue?: number;
}) {
  const [value, setValue] = useState(defaultValue);
  const id = useId();

  return (
    <div>
      <div className="between">
        <label htmlFor={`${id}-range`} className="small muted">
          {label}
        </label>
        <output htmlFor={`${id}-range`} className="slider-value" aria-live="polite">
          {value}
        </output>
      </div>
      <input
        id={`${id}-range`}
        type="range"
        name={name}
        min={0}
        max={10}
        step={0.5}
        value={value}
        onChange={(e) => {
          const parsed = Number(e.target.value);
          if (Number.isFinite(parsed)) setValue(parsed);
        }}
        className="slider"
      />
    </div>
  );
}
