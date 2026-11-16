---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Record `aria-invalid` as `a11y.states.invalid`. The DOM producer read every other ARIA state but not this one, so marking a field invalid left its node unchanged, and `a11yDiff` reported `(no changes)`. Chromium's own tree reports the state, so the same page read differently in a jsdom test and in a Playwright run:

```ts
const before = capture(main);
document.getElementById("zip")!.setAttribute("aria-invalid", "true");
a11yDiff(before, main).text;
// before: (no changes)
// after:  ~ textbox "Postal code": a11y.states.invalid (unset) → true
```

Each value reads as it does in Chromium 153's own tree. None of them is trimmed, so `" false"` is not `"false"`:

- `false` in any case is `false`.
- An empty value or a lowercase `undefined` leaves the state unset.
- `grammar` and `spelling` in any case are `true` on a `textbox`, an `<input>` or `<textarea>` included. On any other role, `searchbox` and `combobox` included, they leave the state unset, as Chromium marks the misspelled text itself there.
- Anything else is `true`, including `TRUE`, `yes`, `UNDEFINED` and `" false"`.

What this changes for you:

- **Tree diffs:** `a11yDiff`, `diffTrees` and `flow().expectChanges` now report a field turning invalid or valid as a change to `a11y.states.invalid`. A committed diff snapshot that covers one now has an extra line, and needs re-recording.
- **Panels:** the tree in `inspector`, `react` and `storybook-addon` shows an `invalid` badge beside the name of an element with `aria-invalid="true"`, and marks the element changed when the attribute flips.
- **Snapshots:** an a11y snapshot prints roles and names, not states, so it does not change.
- **Native validity is not read.** Chromium also reports a form control's own validity, such as an `<input type="email">` holding a bad address, as `invalid`, and reports `invalid: false` on every other form control. The DOM producer reads `aria-invalid` only, so a native tree still carries the state on more nodes than a DOM one.
- **`cli` / `mcp`:** they re-release the bundled engine; their output is unchanged by this release. The tab order from `real-a11y tabs` and `get_tab_order` is the only output they build with the DOM producer, and it prints no states. Everything else they print reads Chromium's own tree, which already reported the state.
