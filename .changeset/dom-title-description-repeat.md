---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/testing": patch
---

The in-page tree no longer gives an element a description that only repeats its own text. `<a href="#setup" title="Setup">Setup</a>` read as link "Setup" described by "Setup"; Chromium exposes no such description, so a screen reader hears none, and the native tree already printed none. It now reads as link "Setup" with no description, in `treeSnapshot`, `tabSequenceSnapshot`, `real-a11y tabs`, the MCP `get_tab_order` tool and the inspector, React and Storybook panels. A `title` that differs from the text, even only in case or spacing, still describes the element, and so does one beside a name from `aria-label` or `alt`, as in Chromium.

`inspector`, `react` and `storybook-addon` bundle the extractor, so they ship the change too; their panels show the description.
