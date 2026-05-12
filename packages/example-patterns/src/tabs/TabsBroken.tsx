import { useState } from "react";

import type { TabsExampleProps } from "./types.js";

// Hand-rolled "broken" tabs. Deliberately wrong on three independent
// axes that Real A11y's panel + audit surface cleanly:
//
//   1. NO role="tablist" / role="tab" / role="tabpanel". The list
//      renders as a plain `<div>` of `<button>`s, the panels as
//      `<div>`s. The semantic tree shows them as a generic group of
//      buttons, not a tablist — `auditSnapshot()` will miss the tab
//      relationship entirely.
//
//   2. NO aria-controls + aria-selected. Even if a screen-reader user
//      figured out it was a tab, they'd have no idea which panel each
//      tab opens or which is active. The IssuesBadge in
//      @real-a11y-dev/inspector flags missing `aria-selected` on
//      buttons that visually look "selected".
//
//   3. NO keyboard arrow-key navigation. Tab moves focus between all
//      tabs (instead of roving tabindex), and ←/→ do nothing. The
//      tab-sequence snapshot shows N entries (one per tab) instead of
//      the APG-correct 1 entry that enters the tablist.
//
// Visually identical to TabsCorrect — same DOM shape under the
// `<div>` wrappers, same styling. Only the ARIA/keyboard layer is
// missing, which is exactly the "looks fine, fails AT" trap Real
// A11y is built to surface.
export function TabsBroken({ defaultValue, panels }: TabsExampleProps) {
  const [active, setActive] = useState(defaultValue);

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 4,
          borderBottom: "1px solid var(--vp-c-border, #ddd)",
        }}
      >
        {panels.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setActive(p.id)}
            style={{
              padding: "8px 12px",
              border: "none",
              borderBottom:
                active === p.id
                  ? "2px solid var(--vp-c-brand-1, #2962d8)"
                  : "2px solid transparent",
              background: "transparent",
              cursor: "pointer",
              font: "inherit",
              fontWeight: active === p.id ? 600 : 400,
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      {panels.map((p) =>
        p.id === active ? (
          <div key={p.id} style={{ padding: "12px 0" }}>
            {p.content}
          </div>
        ) : null,
      )}
    </div>
  );
}
