import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

import type { MenuExampleProps } from "./types.js";

// Correct APG menu button + menu, courtesy of
// @radix-ui/react-dropdown-menu.
//
// Radix provides:
//   - aria-haspopup="menu" + aria-expanded on the trigger
//   - aria-controls on the trigger pointing at the menu's id
//   - role="menu" on the panel, role="menuitem" on each item
//   - Focus moves into the menu on open (first item), returns to
//     trigger on close
//   - ↑/↓ to move between items, Home/End for bounds, Escape closes,
//     typing characters jumps to matching item
//
// Inspecting this surfaces the cross-link chips on the trigger row
// (solid `→ menu`) and the menu row (`← button`) — the explicit
// `aria-controls` relationship the panel renders.
export function MenuCorrect({ trigger, items }: MenuExampleProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
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
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          sideOffset={4}
          style={{
            background: "var(--vp-c-bg-elv, #fff)",
            border: "1px solid var(--vp-c-border, #ccc)",
            borderRadius: 6,
            padding: 4,
            minWidth: 160,
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
          }}
        >
          {items.map((it) => (
            <DropdownMenu.Item
              key={it.id}
              style={{
                padding: "6px 10px",
                borderRadius: 4,
                cursor: "pointer",
                font: "inherit",
                outline: "none",
              }}
            >
              {it.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
