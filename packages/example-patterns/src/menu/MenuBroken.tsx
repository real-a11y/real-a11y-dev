import { useState } from "react";

import type { MenuExampleProps } from "./types.js";

// Hand-rolled "broken" menu button. Deliberately wrong on three axes:
//
//   1. NO aria-haspopup or aria-expanded on the trigger. A screen
//      reader can't tell this button opens a menu, and can't tell
//      whether the menu is currently open.
//
//   2. NO role="menu" / role="menuitem". The panel reads as a generic
//      group of buttons, not a menu. The cross-link chip in the
//      inspector falls back to inferred or doesn't render.
//
//   3. NO focus management. Opening the menu doesn't move focus into
//      it; closing doesn't restore to the trigger. All menu items
//      stay in the page's tab sequence even when the menu is closed.
//
// Visually identical to MenuCorrect — same button, same dropdown
// styling — just no AT signal.
export function MenuBroken({ trigger, items }: MenuExampleProps) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
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
      {open ? (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            background: "var(--vp-c-bg-elv, #fff)",
            border: "1px solid var(--vp-c-border, #ccc)",
            borderRadius: 6,
            padding: 4,
            minWidth: 160,
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
            zIndex: 10,
          }}
        >
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => setOpen(false)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "6px 10px",
                border: "none",
                borderRadius: 4,
                background: "transparent",
                cursor: "pointer",
                font: "inherit",
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
