---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
---

Out-of-range and `display: contents` tab stops no longer appear in the DOM producer's tab sequence.

A `tabindex` outside the signed 32-bit range (for example `tabindex="2147483648"`) is now ignored as if absent, and an element with `display: contents` is no longer reported focusable, matching the Tab order Chromium produces. This changes the output of `real-a11y tabs`, the MCP `get_tab_order` tool, `toHaveTabSequence` / `tabSequenceSnapshot`, and the TAB view. Saved tab-sequence snapshots of markup using either pattern will churn.
