---
"@real-a11y-dev/testing": minor
"@real-a11y-dev/inspector": minor
"@real-a11y-dev/react": minor
"@real-a11y-dev/storybook-addon": minor
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

feat(core): a node now carries the value a screen reader announces for a field, as `a11y.value`, per ADR-0001 ("Field values: withhold what is sensitive, show what a screen reader reads").

- **What it holds.** A text field's or rich-text editor's text; a `<select>`'s selected option **label** (`"Spain"`, where the DOM producer's `dom.attributes.value` keeps the raw `"es"`); a range widget's `aria-valuetext`, else `aria-valuenow`; a file input's file names. A checkbox, radio or button has none. Whitespace collapses and a value is capped at 240 characters. An empty field has no value.
- **Sensitive fields.** A `type="password"` field, or one whose `autocomplete` names a credential or payment field (`current-password`, `new-password`, `one-time-code`, `cc-number`, `cc-csc`, `cc-exp`, `cc-exp-month`, `cc-exp-year`), reads `"[redacted]"` when it holds anything. The token list is unchanged and is now exported for reuse, with `isSensitiveFieldAttributes` for callers that hold a field's markup but no live element.
- **Printing it is opt-in.** The tree, tab-sequence, list and diff serializers gain a `values` option, default **off**, so every existing snapshot is byte-identical. With it on, a field prints as `textbox "Email" = "jane@x.com"`, and a diff reports `~ textbox "Search": a11y.value (unset) → "hello"`. In testing: `treeSnapshot(root, { values: true })`, `boxedTreeSnapshot`, the Playwright adapter's `sn.treeSnapshot({ values: true })`, and `a11yDiff(before, after, { values: true })`.
- **`expectChanges({ exact: true })`** now sees field-value changes, since diffs model them, but never counts a change made only of `a11y.value` as unexpected: typing into a field changes that field, which is the step itself. Assert it explicitly with `changes: ["a11y.value"]`.

- **A role-less editor is no longer named after what was typed into it.** `<div contenteditable>draft</div>` read `generic "draft"` and now reads an unnamed `generic` whose value is `"draft"`. It stays in the accessibility view as a field, and serializers print it as `generic = "draft"` with `values: true`. Chromium leaves it unnamed too.
- **Diff views see value changes.** A panel diff (inspector, storybook-addon, extension) now marks a field you typed into as changed.

A hostile page whose `.value` getter throws no longer costs the field its node; the value is simply absent.

`cli` and `mcp` re-release the bundled engine; their output is unchanged by this release.
