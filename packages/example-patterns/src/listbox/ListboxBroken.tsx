import { useState } from "react";

import type { ListboxExampleProps } from "./types.js";

// Hand-rolled "broken" listbox. Deliberately wrong on the selection
// model and role axis:
//
//   1. NO role="listbox" on the container, NO aria-label. The
//      container reads as a generic group/div.
//
//   2. Items are plain <button>s with NO role="option" and NO
//      aria-selected on the selected one. Selection is conveyed
//      visually (font-weight: 600) only — invisible to AT.
//
//   3. NO roving tabindex. Every button stays in the tab sequence, so
//      Tab moves through them one by one instead of arrow keys
//      navigating within a single tab stop.
//
// Visually identical to ListboxCorrect — same border, same item
// styling, same bold-on-selection — just no AT signal.
export function ListboxBroken({
  label: _label,
  options,
  defaultSelectedId,
}: ListboxExampleProps) {
  const [selectedId, setSelectedId] = useState<string | undefined>(
    defaultSelectedId,
  );

  return (
    <div
      style={{
        border: "1px solid var(--vp-c-border, #ccc)",
        borderRadius: 6,
        padding: 4,
        minWidth: 200,
        background: "var(--vp-c-bg-elv, #fff)",
      }}
    >
      {options.map((opt) => {
        const isSelected = opt.id === selectedId;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => setSelectedId(opt.id)}
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
              fontWeight: isSelected ? 600 : 400,
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
