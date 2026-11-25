---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
---

The DOM producer's tab sequence now lists a focusable frame. An `<iframe>`, and an `<object>` showing an HTML or SVG document, are one stop where Tab enters them, as in Chromium; before, `real-a11y tabs`, `get_tab_order`, `getTabSequence` and `toHaveTabSequence` left them out. A frame with a negative `tabindex`, `visibility: hidden`, `inert` or `display: contents` stays out. Side effects: an `iframe` in the inspector, react and storybook-addon trees gains a focusable mark and a FOCUS action, and an `<object>` showing a document appears as an unnamed `generic` node. `isFocusable()` is unchanged, so roles and states do not move. Saved snapshots and tab-order assertions over pages with frames will churn.
