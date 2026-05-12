import * as Collapsible from "@radix-ui/react-collapsible";

import type { DisclosureExampleProps } from "./types.js";

// Correct APG disclosure (Show/Hide), courtesy of
// @radix-ui/react-collapsible.
//
// Radix provides:
//   - aria-expanded on the trigger (toggles with open state)
//   - aria-controls on the trigger pointing at the content's id
//   - The content is hidden via `hidden` attribute when collapsed,
//     not just `display: none` — keeps it out of the AT tree.
//
// In the inspector, this surfaces a solid `→ region` chip on the
// trigger row and a `← button` chip on the panel row — the
// cross-link arrows the panel shows for explicit `aria-controls`.
export function DisclosureCorrect({
  trigger,
  children,
  defaultOpen = false,
}: DisclosureExampleProps) {
  return (
    <Collapsible.Root defaultOpen={defaultOpen}>
      <Collapsible.Trigger
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
      </Collapsible.Trigger>
      <Collapsible.Content
        style={{ marginTop: 8, padding: "8px 0", color: "var(--vp-c-text-2)" }}
      >
        {children}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
