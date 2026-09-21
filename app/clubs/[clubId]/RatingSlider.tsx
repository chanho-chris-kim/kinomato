"use client";

import { useId, useState } from "react";

// The second client component in this codebase, after
// NominationSelector — same justification: keeping the number input and
// slider in sync needs local state a plain form can't express. The
// server action still validates the submitted value independently
// (never trusting what the client sent), so this component's only job
// is the live display and the two inputs agreeing with each other.
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

  function setFromInput(raw: string) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) setValue(parsed);
  }

  return (
    <div>
      <label htmlFor={`${id}-range`}>{label}</label>{" "}
      <input
        id={`${id}-range`}
        type="range"
        min={0}
        max={10}
        step={0.5}
        value={value}
        onChange={(e) => setFromInput(e.target.value)}
      />{" "}
      <span aria-hidden="true">{value}</span>{" "}
      <input
        type="number"
        min={0}
        max={10}
        step={0.5}
        value={value}
        aria-label={`${label} (as a number)`}
        onChange={(e) => setFromInput(e.target.value)}
        className="border w-16"
      />
      {/* The one input actually submitted — the range, the live number,
          and the number input are all just views onto the same state. */}
      <input type="hidden" name={name} value={value} />
    </div>
  );
}
