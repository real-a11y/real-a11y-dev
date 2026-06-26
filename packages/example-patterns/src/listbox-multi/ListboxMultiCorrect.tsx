import { ListBox, ListBoxItem } from "react-aria-components";

import type { ListboxMultiExampleProps } from "./types.js";

// Correct APG multi-select Listbox, courtesy of react-aria-components.
//
// Multi-select adds to the single-select model from the basic Listbox:
//   - aria-multiselectable="true" on the listbox container (so AT
//     announces "1 of 5 selected" style state, not "selected" alone)
//   - aria-selected on every option reflecting whether it's part of the
//     selection — multiple can be true at once
//   - Selection model accepts Shift+click for range select, Ctrl/Cmd+
//     click for toggle, Space to toggle the focused item
//   - Keyboard nav (↑/↓/Home/End/typeahead) carries over from
//     single-select; selectionBehavior="toggle" makes each Space/Enter
//     flip the focused item instead of moving selection with focus
//
// Inspecting this surfaces the `listbox > option*` chain with multiple
// `selected` state badges and the aria-multiselectable flag.
export function ListboxMultiCorrect({
  label,
  options,
  defaultSelectedIds,
}: ListboxMultiExampleProps) {
  return (
    <ListBox
      aria-label={label}
      selectionMode="multiple"
      selectionBehavior="toggle"
      defaultSelectedKeys={defaultSelectedIds ?? []}
      style={{
        border: "1px solid var(--vp-c-border, #ccc)",
        borderRadius: 6,
        padding: 4,
        minWidth: 220,
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
            display: "flex",
            alignItems: "center",
            gap: 8,
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
          {({ isSelected }) => (
            <>
              {/* Visual checkbox glyph — purely decorative. React Aria
                  manages the actual aria-selected state on the option. */}
              <span
                aria-hidden="true"
                style={{
                  display: "inline-block",
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  border: "1px solid var(--vp-c-border, #999)",
                  background: isSelected
                    ? "var(--vp-c-brand, #2e79ff)"
                    : "transparent",
                  color: "#fff",
                  textAlign: "center",
                  fontSize: 10,
                  lineHeight: "12px",
                }}
              >
                {isSelected ? "✓" : ""}
              </span>
              {opt.label}
            </>
          )}
        </ListBoxItem>
      ))}
    </ListBox>
  );
}
