---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Fix which elements the tab sequence counts as stops. It counted every `<a>`, with or without an `href`, every `tabindex` attribute whatever its value, and a control disabled by its `<fieldset>`, although Chromium focuses none of them. It also left out an `aria-disabled` control, which Chromium does tab to. On this page:

```html
<a name="top">Back to top</a>
<a role="button">Save draft</a>
<a href="/docs">Docs</a>
<button aria-disabled="true">Publish</button>
<fieldset disabled><button>Save</button></fieldset>
<div tabindex="">Card</div>
```

`real-a11y tabs` printed

```
01. generic "Back to top"
02. button "Save draft"
03. link "Docs"
04. button "Save"
05. generic "Card"
```

and now prints the two stops Chromium tabs through:

```
01. link "Docs"
02. button "Publish"
```

The `<a role="button">` is the one that matters. It is a button no keyboard can reach, which is what a tab order is for catching, and it was listed as a stop.

What counts as a stop, all checked against Chromium 151:

- **Link:** an `<a>` needs an `href` or a `tabindex`.
- **Disabled:** a control disabled directly or by a `<fieldset disabled>` is not a stop, unless it sits in that fieldset's first `<legend>`. `aria-disabled` announces a state and leaves focus alone, so its control stays a stop.
- **`tabindex`:** read the way HTML parses an integer. `""` and `"abc"` are ignored, `"1abc"` is 1 and `"0.5"` is 0. Any negative value takes an element out of the order, not just `-1`.

Where it shows:

- **`cli` / `mcp`:** `real-a11y tabs` and `get_tab_order` only. Every other view reads Chromium's own tree and is unchanged.
- **Snapshots and assertions:** `tabSequenceSnapshot` and `toHaveTabSequence` lose the stops above and gain `aria-disabled` controls. Re-record those baselines.
- **Panels:** the Tab Sequence view in `inspector`, `react` and `storybook-addon` follows the same rules, and so does the tree's "focusable" badge.
- **`interaction` facet:** `isFocusable` now says what Chromium says for every node, so it is `false` for an `<a>` without `href`, a disabled control and an element whose `tabindex` is not an integer.
- **`role="none"` / `role="presentation"`:** it gives way on a focusable element, and focusable now means the same thing here. So the role now applies to a control in a disabled fieldset, and no longer applies to an element with `tabindex="1abc"`. A DOM-mode a11y snapshot can change for either.
