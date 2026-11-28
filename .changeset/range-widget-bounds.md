---
"@real-a11y-dev/testing": minor
"@real-a11y-dev/inspector": minor
"@real-a11y-dev/react": minor
"@real-a11y-dev/storybook-addon": minor
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Report a range widget's bounds as `a11y.properties.valuemin` and `valuemax` in DOM-produced trees. The DOM producer left the size of a slider, scrollbar, focusable separator, meter or progress bar out of its tree, so `a11yDiff` reported no change when `max` moved, and a DOM tree could not say what a native one (from `real-a11y tree`, MCP or the Playwright adapter's `tree: "native"`) already did.

Each bound takes the authored `aria-valuemin`/`aria-valuemax` first, then HTML `min`/`max` on `<input type="range">`, `<input type="number">`, `<meter>` and `<progress>`, then the implicit default. The defaults are 0 and 100 for a slider, scrollbar, focusable separator, meter or progressbar, HTML's own for `<input type="range">` (0 and 100), `<meter>` (0 and 1) and `<progress>` (0 and its `max`, which defaults to 1). A spinbutton and `<input type="number">` get no default, and an empty or unparsable bound counts as absent. Numbers print as `String(Number(raw))`, so `1e2` is `"100"`.

What this changes for you:

- **Tree diffs and `toEqual` on `a11y.properties`:** a range widget's node gains `valuemin` and `valuemax`, so a saved diff or an assertion on the whole `properties` object needs updating.
- **Current value:** unchanged. A slider with no `aria-valuenow` still has no value, where Chromium's tree says `50`.
- **Still different from Chromium's tree:** Chromium reports `0`/`0` for a spinbutton and `valuemax=0` for `<input type="number" min="1">`, and turns an empty `aria-valuemax` into `0`. The DOM producer reports none of those.
- **Snapshots:** a text snapshot prints roles and names, not these properties, so it does not change.
