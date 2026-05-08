import * as RadixTabs from "@radix-ui/react-tabs";

import type { TabsExampleProps } from "./types.js";

// Correct APG tabs implementation, courtesy of @radix-ui/react-tabs.
//
// Radix gives us, for free:
//   - role="tablist" / role="tab" / role="tabpanel"
//   - aria-selected on the active tab
//   - aria-controls / id pairing between tab and panel
//   - Roving tabindex (only the active tab is in tab order)
//   - ←/→/Home/End keyboard navigation
//   - Manual activation by default (Enter/Space activates)
//   - Focus management when activating a tab
//
// Inspecting this with `@real-a11y-dev/inspector` shows a clean
// `tablist > tab*` structure with all the right roles and chips.
// Auditing with `@real-a11y-dev/testing`'s `auditSnapshot()`
// produces a stable tree of named tabs + the active panel.
export function TabsCorrect({
  defaultValue,
  panels,
  label = "Tabs",
}: TabsExampleProps) {
  return (
    <RadixTabs.Root defaultValue={defaultValue}>
      <RadixTabs.List
        aria-label={label}
        style={{
          display: "flex",
          gap: 4,
          borderBottom: "1px solid var(--vp-c-border, #ddd)",
        }}
      >
        {panels.map((p) => (
          <RadixTabs.Trigger
            key={p.id}
            value={p.id}
            style={{
              padding: "8px 12px",
              border: "none",
              borderBottom: "2px solid transparent",
              background: "transparent",
              cursor: "pointer",
              font: "inherit",
            }}
          >
            {p.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {panels.map((p) => (
        <RadixTabs.Content
          key={p.id}
          value={p.id}
          style={{ padding: "12px 0" }}
        >
          {p.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
