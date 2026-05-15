import type { ToolbarExampleProps } from "./types.js";

// Hand-rolled "broken" toolbar. Deliberately wrong on two axes:
//
//   1. NO role="toolbar" or aria-label on the container. The group
//      of buttons reads as a generic cluster, not a named region.
//      The audit snapshot has no `toolbar` line.
//
//   2. NO roving tabindex. Every button is in the tab sequence, so
//      Tab walks through N items instead of entering the toolbar
//      once and moving with ←/→. Tab-sequence snapshot proves this:
//      N button entries for the broken variant vs 1 toolbar entry
//      for the correct one.
//
// Visually identical to ToolbarCorrect — same button layout, same
// brand styling.
export function ToolbarBroken({ items }: ToolbarExampleProps) {
  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        padding: 4,
        background: "var(--vp-c-bg-soft, #f6f6f6)",
        borderRadius: 6,
      }}
    >
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
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
        </button>
      ))}
    </div>
  );
}
