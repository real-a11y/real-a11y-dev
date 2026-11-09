---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/testing": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

The DOM-produced tree now exposes an element's `title` as its accessible description when the `title` was not its name (HTML-AAM §4.2). `<button aria-label="AL" title="Ti">` is `button "AL"` with description `"Ti"`, as in Chromium and the native producer; before, its description was empty. `aria-describedby` and `aria-description` still win over `title`, and a `title` that is the name stays out of the description. Saved DOM-produced snapshots, searches and diffs that read `a11y.description` will see the new text. `cli` and `mcp` bundle the same code but read Chromium's own tree, so their output is unchanged.
