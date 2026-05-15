import { useState } from "react";

import type { DisclosureExampleProps } from "./types.js";

// Hand-rolled "broken" disclosure. Deliberately wrong on two axes:
//
//   1. NO aria-expanded on the trigger. Screen reader users can't
//      tell from the button alone whether the content is currently
//      open. The Real A11y panel highlights the state chip's absence.
//
//   2. NO aria-controls pointing from the trigger to the panel.
//      The panel's cross-link chip (`→ region` from button) won't
//      render — the inspector either falls back to an inferred
//      (dashed) chip or shows no relationship at all, depending on
//      whether `aria-haspopup` is set elsewhere.
//
// The panel content is still hidden via `display: none` when closed,
// so the visual behavior matches DisclosureCorrect — only the ARIA
// metadata is missing.
export function DisclosureBroken({
  trigger,
  children,
  defaultOpen = false,
}: DisclosureExampleProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          padding: "6px 12px",
          border: "1px solid var(--vp-c-border, #ccc)",
          borderRadius: 6,
          background: "transparent",
          cursor: "pointer",
          font: "inherit",
        }}
      >
        {trigger}
      </button>
      <div
        style={{
          marginTop: 8,
          padding: "8px 0",
          color: "var(--vp-c-text-2)",
          display: open ? "block" : "none",
        }}
      >
        {children}
      </div>
    </div>
  );
}
