---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Count the `<summary>` that toggles a `<details>` as a tab stop. Chromium tabs to it, but the tab sequence never counted one, so every disclosure and FAQ accordion question was missing. On this page:

```html
<details>
  <summary>How long does shipping take?</summary>
  <p>3 to 5 days.</p>
</details>
<details>
  <summary>Can I return an item?</summary>
  <p>Within 30 days.</p>
</details>
<a href="/contact">Contact us</a>
```

`real-a11y tabs` printed

```
01. link "Contact us"
```

and now prints

```
01. generic "How long does shipping take?"
02. generic "Can I return an item?"
03. link "Contact us"
```

Only the first `<summary>` child of a `<details>` is a stop, as in Chromium 151, even with other content before it. A second summary, a summary nested deeper, or one outside any `<details>` stays plain text. A `<fieldset disabled>` does not disable a summary, since it is no form control.

Where it shows:

- **`cli` / `mcp`:** `real-a11y tabs` and `get_tab_order` only. Every other view reads Chromium's own tree and is unchanged.
- **Snapshots and assertions:** `tabSequenceSnapshot` and `toHaveTabSequence` gain a stop for each details' summary, and mark one `[focused]` when it has focus. Re-record those baselines.
- **Panels:** the Tab Sequence view in `inspector`, `react` and `storybook-addon` lists the same stops, and the tree's "focusable" badge shows on the summary.
- **The DOM a11y tree:** a details' summary used to be dropped from it, since its text names the `<details>`. It now stays as a `generic` child of the `<details>` group, with only its interactive descendants under it, as does any other name source Chromium can focus, such as a `<legend tabindex="0">`. `treeSnapshot` hides generics by default, so its default output is unchanged; with `includeGeneric: true` the summary line appears.
- **`interaction` facet:** `isFocusable` is `true` for a details' summary.
- **`role="none"` / `role="presentation"`:** it no longer applies to a details' summary, which is focusable. Chromium ignores it there too.
