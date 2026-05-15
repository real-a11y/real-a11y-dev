import * as RadixToolbar from "@radix-ui/react-toolbar";

import type { ToolbarExampleProps } from "./types.js";

// Correct APG toolbar, courtesy of @radix-ui/react-toolbar.
//
// Radix provides:
//   - role="toolbar" on the container with the supplied aria-label
//   - Roving tabindex: only one item is in tab order at a time;
//     Tab enters the toolbar, ←/→ move within it
//   - role="button" on each item (or its native role)
//
// Tab-sequence snapshot shows ONE entry for the toolbar (the
// currently-focused item), not N — that's the keyboard-economy
// promise of the roving-tabindex pattern.
export function ToolbarCorrect({ label, items }: ToolbarExampleProps) {
  return (
    <RadixToolbar.Root
      aria-label={label}
      style={{
        display: "flex",
        gap: 4,
        padding: 4,
        background: "var(--vp-c-bg-soft, #f6f6f6)",
        borderRadius: 6,
      }}
    >
      {items.map((it) => (
        <RadixToolbar.Button
          key={it.id}
          style={{
            padding: "6px 10px",
            border: "1px solid transparent",
            borderRadius: 4,
            background: "transparent",
            cursor: "pointer",
            font: "inherit",
          }}
        >
          {it.label}
        </RadixToolbar.Button>
      ))}
    </RadixToolbar.Root>
  );
}
