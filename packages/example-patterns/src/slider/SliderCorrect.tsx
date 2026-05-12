import * as RadixSlider from "@radix-ui/react-slider";

import type { SliderExampleProps } from "./types.js";

// Correct APG slider, courtesy of @radix-ui/react-slider.
//
// Radix provides:
//   - role="slider" on the thumb
//   - aria-valuemin / aria-valuemax / aria-valuenow
//   - aria-orientation
//   - ←/→ for fine increments, ↑/↓ for vertical, Home/End for bounds,
//     PageUp/PageDown for coarse steps
//   - Focus management on the thumb
//
// Auditing this produces a `slider "<label>" <value>` line in the
// audit snapshot — the role + name + current value are all visible.
export function SliderCorrect({
  label,
  defaultValue,
  min = 0,
  max = 100,
  step = 1,
}: SliderExampleProps) {
  return (
    <RadixSlider.Root
      defaultValue={[defaultValue]}
      min={min}
      max={max}
      step={step}
      aria-label={label}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        userSelect: "none",
        width: 220,
        height: 24,
      }}
    >
      <RadixSlider.Track
        style={{
          background: "var(--vp-c-border, #ddd)",
          position: "relative",
          flexGrow: 1,
          borderRadius: 9999,
          height: 4,
        }}
      >
        <RadixSlider.Range
          style={{
            position: "absolute",
            background: "var(--vp-c-brand-1, #2962d8)",
            borderRadius: 9999,
            height: "100%",
          }}
        />
      </RadixSlider.Track>
      <RadixSlider.Thumb
        style={{
          display: "block",
          width: 16,
          height: 16,
          background: "var(--vp-c-brand-1, #2962d8)",
          borderRadius: 9999,
          cursor: "pointer",
        }}
      />
    </RadixSlider.Root>
  );
}
