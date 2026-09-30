---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Report a control disabled by its `<fieldset>` as disabled. The DOM producer read a control's `disabled` state from the control's own `disabled` attribute only. In this form, `Save` has no attribute of its own:

```html
<fieldset disabled>
  <legend><button>Unlock</button></legend>
  <button>Save</button>
</fieldset>
```

HTML and Chromium both treat `Save` as disabled. So a screen reader announces it as unavailable, and the tab sequence already skips it. But its node carried no `a11y.states.disabled`, and a `<button aria-disabled="false">` in the same place was reported as explicitly not disabled. Both now read `disabled: true`.

The exemption stays as HTML defines it: a control in the fieldset's first `<legend>`, like `Unlock`, is not disabled. That covers every `<button>`, `<input>`, `<select>` and `<textarea>`, including one in a nested fieldset, and each case matches the `disabled` property of Chromium 151's own tree.

- **Queries:** `findByRole` / `findAllByRole` with `{ disabled: true }` now match these controls.
- **Tree diffs:** toggling a fieldset's `disabled` now changes the state of every control inside it. `a11yDiff` prints `~ button "Save": a11y.states.disabled (unset) → true` for each one, so a committed diff snapshot around such a toggle gains those lines. Re-record it. `flow().expectChanges` can now assert the change with `changes: ["a11y.states.disabled"]`. A spec that already passed still passes, because it matches changes as a subset.
- **Panels:** the tree's `disabled` badge in `inspector`, `react` and `storybook-addon` now shows on these controls.
- **Snapshots:** unchanged. An a11y snapshot prints roles and names, not states.
- **`cli` / `mcp`:** nothing they print changes. The page walk that ships inside them has the fix, but no output of theirs shows a DOM-produced state.
