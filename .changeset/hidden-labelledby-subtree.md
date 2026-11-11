---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Read the whole subtree of a hidden `aria-labelledby` or `aria-describedby` target. When the directly referenced node is hidden, AccName 1.2 §2B has user agents include every node in its subtree, hidden descendants too. The DOM producer dropped them, so the name came out short, or fell back to `aria-label` when all of the target's text sat in hidden children:

```html
<span id="l" style="display:none"
  >foo <span style="display:none">bar</span></span
>
<button aria-labelledby="l">x</button>
<!-- button "foo bar" (was "foo") -->

<button aria-labelledby="s" aria-label="foo">
  <span id="s" style="display:none"
    ><span style="display:none">label</span></span
  >x
</button>
<!-- button "label" (was "foo", from aria-label) -->
```

A hidden child of a visible target is still dropped, and Chromium's own tree (`cli` and `mcp` read it) already gave these names. What this changes for you:

- **Names and descriptions:** the DOM producer's name or description for a widget labelled or described by a hidden element changes from the truncated text to the full text. `getByRole("button", { name })` queries and assertions written against the old name need updating.
- **Snapshots:** a11y snapshots produced by the DOM producer for such widgets churn, so a saved one needs re-recording.
- **`cli` and `mcp`:** only `tabs` and `get_tab_order` use the DOM producer, so only the names they list change.
