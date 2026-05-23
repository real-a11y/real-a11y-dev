import {
  Button,
  ComboBox,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
} from "react-aria-components";

import type { ComboboxExampleProps } from "./types.js";

// Correct APG combobox, courtesy of react-aria-components.
//
// React Aria provides:
//   - role="combobox" on the input + aria-expanded reflecting popover
//     state + aria-controls pointing at the listbox's id
//   - role="listbox" + role="option" inside the portaled popover
//   - aria-activedescendant updated as the user arrows through options
//   - Free-text filtering with announced result count via aria-live
//   - Keyboard nav (↓ opens, ↑/↓ moves, Home/End for bounds, Enter
//     selects, Escape closes / clears)
//
// Inspecting this surfaces the `combobox > listbox > option*` chain
// once the popover opens; the cross-link chip shows the
// `aria-controls` relationship between input and listbox.
export function ComboboxCorrect({
  label,
  options,
  placeholder,
}: ComboboxExampleProps) {
  return (
    <ComboBox
      style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}
    >
      <Label style={{ font: "inherit" }}>{label}</Label>
      <div style={{ display: "inline-flex" }}>
        <Input
          placeholder={placeholder}
          style={{
            padding: "6px 10px",
            border: "1px solid var(--vp-c-border, #ccc)",
            borderRight: "none",
            borderRadius: "6px 0 0 6px",
            background: "var(--vp-c-bg-elv, #fff)",
            font: "inherit",
            minWidth: 180,
          }}
        />
        <Button
          style={{
            padding: "0 10px",
            border: "1px solid var(--vp-c-border, #ccc)",
            borderRadius: "0 6px 6px 0",
            background: "transparent",
            cursor: "pointer",
            font: "inherit",
          }}
        >
          ▾
        </Button>
      </div>
      <Popover>
        <ListBox
          style={{
            background: "var(--vp-c-bg-elv, #fff)",
            border: "1px solid var(--vp-c-border, #ccc)",
            borderRadius: 6,
            padding: 4,
            minWidth: 200,
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
            outline: "none",
          }}
        >
          {options.map((opt) => (
            <ListBoxItem
              key={opt.id}
              id={opt.id}
              textValue={opt.label}
              style={({ isFocused }) => ({
                padding: "6px 10px",
                borderRadius: 4,
                cursor: "pointer",
                font: "inherit",
                outline: "none",
                background: isFocused
                  ? "var(--vp-c-default-soft, rgba(0,0,0,0.05))"
                  : "transparent",
              })}
            >
              {opt.label}
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </ComboBox>
  );
}
