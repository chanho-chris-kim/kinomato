"use client";

import { useEffect, useRef } from "react";

// The fifth justified client component (2026-11-26): only the browser knows
// the device's time zone. Left empty, the field is filled with it once,
// when it's a zone this browser lists (Intl.supportedValuesOf); anything
// typed or echoed back is never replaced. Still required, and the server
// validates it (lib/clubDetails.ts). Without script it stays empty.
export function TimezoneField({ defaultValue, listId }: { defaultValue: string; listId: string }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = input.current;
    if (!el || el.value) return;
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && Intl.supportedValuesOf("timeZone").includes(zone)) el.value = zone;
  }, []);
  return (
    <input
      ref={input}
      type="text"
      name="timezone"
      list={listId}
      placeholder="America/New_York"
      required
      defaultValue={defaultValue}
    />
  );
}
