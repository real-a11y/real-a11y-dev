import { useState } from "react";

import type { ListboxMultiExampleProps } from "./types.js";

// Hand-rolled "broken" multi-select Listbox. Deliberately wrong on
// the multi-selection model:
//
//   1. NO role="listbox" on the container, NO aria-multiselectable.
//      Reads as a generic group of checkboxes.
//
//   2. Items are <input type="checkbox"> + <label> pairs — selection
//      is visually conveyed via the native checkbox, but the
//      group-level relationship (listbox + option) is missing.
//      Screen readers announce each as an individual checkbox, not
//      "1 of 5 selected" within a listbox.
//
//   3. NO keyboard nav between options. Tab moves through each
//      checkbox individually rather than ↑/↓ within one tab stop.
//
//   4. NO range-select (Shift+click) or selection-behavior model.
//
// Visually similar to the correct variant — a list of checkable
// items — but the multi-select widget shape is lost.
export function ListboxMultiBroken({
  label: _label,
  options,
  defaultSelectedIds,
}: ListboxMultiExampleProps) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(defaultSelectedIds ?? []),
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div
      style={{
        border: "1px solid var(--vp-c-border, #ccc)",
        borderRadius: 6,
        padding: 4,
        minWidth: 220,
        background: "var(--vp-c-bg-elv, #fff)",
      }}
    >
      {options.map((opt) => {
        const isSelected = selected.has(opt.id);
        return (
          <label
            key={opt.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px",
              borderRadius: 4,
              cursor: "pointer",
              font: "inherit",
              fontWeight: isSelected ? 600 : 400,
            }}
          >
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => toggle(opt.id)}
            />
            {opt.label}
          </label>
        );
      })}
    </div>
  );
}
