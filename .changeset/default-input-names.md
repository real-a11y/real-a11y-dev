---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Give a submit, reset or image input its default name in the DOM producer. HTML-AAM names `<input type="submit">` "Submit" and `<input type="reset">` "Reset" when they have no `value` attribute, ahead of `title`, and an `<input type="image">` with neither `alt` nor `title` "Submit". The DOM producer left all three nameless, so every DOM surface printed `button ""` and the `no-unlabeled-interactive` rule reported errors on forms that assistive technology announces correctly:

```html
<input type="submit" />
<!-- button "Submit" (was "") -->
<input type="reset" />
<!-- button "Reset" (was "") -->
<input type="image" src="data:," />
<!-- button "Submit" (was "") -->
<input type="submit" title="Go" />
<!-- button "Submit" (was "Go") -->
```

`value=""` is still a stated empty name, and `<input type="button">` has no default. Chromium's own tree (which `cli` and `mcp` read) already gave these names. The strings are fixed English. What this changes for you:

- **Names:** the DOM producer's name for such an input changes from empty (or from its `title`) to `Submit` or `Reset`. `getByRole("button", { name })` queries written against the old name need updating.
- **Snapshots:** a11y snapshots produced by the DOM producer for forms with these inputs churn, so a saved one needs re-recording.
- **Audit:** `toHaveNoUnlabeledInteractive` and `no-unlabeled-interactive` no longer fail on these inputs.
- **`cli` and `mcp`:** only `tabs` and `get_tab_order` use the DOM producer, so only the names they list change.
