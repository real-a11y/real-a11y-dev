import { ListBox, ListBoxItem } from "react-aria-components";

import type { ListboxExampleProps } from "./types.js";

// Correct APG listbox, courtesy of react-aria-components.
//
// React Aria provides:
//   - role="listbox" on the container + aria-label from the prop
//   - role="option" on each item with aria-selected reflecting state
//   - Single-select selection model with keyboard nav (↑/↓ to move,
//     Home/End for bounds, typeahead, Enter/Space to select)
//   - Roving tabindex so only the active option is in the tab sequence
//
// Inspecting this surfaces the `listbox > option*` tree with the
// selected option's `selected` state set on the appropriate row.
export function ListboxCorrect({
  label,
  options,
  defaultSelectedId,
}: ListboxExampleProps) {
  return (
    <ListBox
      aria-label={label}
      selectionMode="single"
      defaultSelectedKeys={defaultSelectedId ? [defaultSelectedId] : undefined}
      style={{
        border: "1px solid var(--vp-c-border, #ccc)",
        borderRadius: 6,
        padding: 4,
        minWidth: 200,
        background: "var(--vp-c-bg-elv, #fff)",
        outline: "none",
      }}
    >
      {options.map((opt) => (
        <ListBoxItem
          key={opt.id}
          id={opt.id}
          textValue={opt.label}
          style={({ isSelected, isFocused }) => ({
            padding: "6px 10px",
            borderRadius: 4,
            cursor: "pointer",
            font: "inherit",
            outline: "none",
            background: isFocused
              ? "var(--vp-c-default-soft, rgba(0,0,0,0.05))"
              : "transparent",
            fontWeight: isSelected ? 600 : 400,
          })}
        >
          {opt.label}
        </ListBoxItem>
      ))}
    </ListBox>
  );
}
