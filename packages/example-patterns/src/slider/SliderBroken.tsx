import { useRef, useState } from "react";

import type { SliderExampleProps } from "./types.js";

// Hand-rolled "broken" slider. Deliberately wrong on three independent
// axes that Real A11y surfaces cleanly:
//
//   1. NO role="slider". The thumb is a plain `<div>` — the audit
//      snapshot shows no `slider` line at all; the panel sees a
//      generic group, not an interactive control.
//
//   2. NO aria-valuemin / aria-valuemax / aria-valuenow. Even if a
//      reader inferred "it's a slider", there's no way to know the
//      bounds or the current value. The audit snapshot can't include
//      the value the way it does for SliderCorrect.
//
//   3. NO keyboard support. The thumb is updated only by mouse drag.
//      Keyboard users can't change the value at all — fails WCAG
//      2.1.1 (Keyboard).
//
// Visually identical to SliderCorrect — same track, same thumb,
// same brand colour.
export function SliderBroken({
  label,
  defaultValue,
  min = 0,
  max = 100,
}: SliderExampleProps) {
  const [value, setValue] = useState(defaultValue);
  const trackRef = useRef<HTMLDivElement>(null);

  function updateFromPointer(clientX: number) {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setValue(Math.round(min + pct * (max - min)));
  }

  const percent = ((value - min) / (max - min)) * 100;

  return (
    <div
      // Note: title is enough for a sighted user, but a screen reader
      // user gets nothing useful — the inner div isn't focusable, has
      // no role, no value attributes.
      title={label}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        userSelect: "none",
        width: 220,
        height: 24,
      }}
    >
      <div
        ref={trackRef}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          updateFromPointer(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) updateFromPointer(e.clientX);
        }}
        style={{
          background: "var(--vp-c-border, #ddd)",
          position: "relative",
          flexGrow: 1,
          borderRadius: 9999,
          height: 4,
          cursor: "pointer",
        }}
      >
        <div
          style={{
            position: "absolute",
            background: "var(--vp-c-brand-1, #2962d8)",
            borderRadius: 9999,
            height: "100%",
            width: `${percent}%`,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: `calc(${percent}% - 8px)`,
            top: -6,
            width: 16,
            height: 16,
            background: "var(--vp-c-brand-1, #2962d8)",
            borderRadius: 9999,
          }}
        />
      </div>
    </div>
  );
}
