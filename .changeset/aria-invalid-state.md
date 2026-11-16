---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Record a field's invalid state as `a11y.states.invalid`, from `aria-invalid` and from the field's own validity. The DOM producer read neither, so a field marked `aria-invalid="true"`, or one failing its `pattern`, looked valid, and `a11yDiff` reported `(no changes)` when it became invalid. Chromium's own tree reports both, so the same page read differently in a jsdom test and in a Playwright run:

```ts
const before = capture(main);
document.getElementById("zip")!.setAttribute("aria-invalid", "true");
a11yDiff(before, main).text;
// before: (no changes)
// after:  ~ textbox "Postal code": a11y.states.invalid (unset) → true
```

**`aria-invalid`** reads as it does in Chromium 153's own tree, except for `grammar` and `spelling`. None of the values is trimmed, so `" false"` is not `"false"`:

- `false` in any case is `false`.
- An empty value or a lowercase `undefined` leaves the state unset.
- `grammar` and `spelling` in any case are kept as `"grammar"` and `"spelling"`, on every role, as WAI-ARIA 1.2 defines them. Chromium reads both as `true` on a textbox and drops them on other roles.
- Anything else is `true`, including `TRUE`, `yes`, `UNDEFINED` and `" false"`.

**A field's own validity** decides the state when `aria-invalid` doesn't. An `<input>`, `<select>`, `<textarea>` or `<button>` is `invalid: true` when it fails HTML constraint validation: a `pattern` mismatch, a bad email or URL, a number out of range, or an error set with `setCustomValidity()`. Two cases follow HTML-AAM where Chromium doesn't:

- **A required field that is only empty** becomes invalid only after the user has interacted with it or tried to submit its form, which is when `:user-invalid` matches. HTML-AAM says it must not start out invalid. jsdom never matches `:user-invalid`, so in jsdom an empty required field never becomes invalid. Chromium never marks an empty text field invalid, and marks an empty required `<select>`, checkbox or radio invalid from the start.
- **A disabled or readonly field**, a plain button, or anything else HTML leaves out of validation is never invalid, even with a custom error. Chromium marks those invalid when they have one.

`aria-invalid="false"` keeps a field that fails validation valid. A valid field gets no `invalid` state at all.

What this changes for you:

- **Tree diffs:** `a11yDiff`, `diffTrees` and `flow().expectChanges` now report a field turning invalid or valid as a change to `a11y.states.invalid`, whether `aria-invalid` changed or the value did. A committed diff snapshot that covers one now has an extra line, and needs re-recording.
- **Panels:** the tree in `inspector`, `react` and `storybook-addon` shows an `invalid` badge beside an invalid field's name, or `invalid=spelling` for that token, and marks the field changed when its state flips. The live tree also catches a value or custom error that script changed, the next time anything else on the page changes.
- **Snapshots:** an a11y snapshot prints roles and names, not states, so it does not change.
- **Still different from Chromium's tree:** besides the cases above, Chromium reports `invalid: false` on every valid form control, and reads a form-associated custom element's validity, which page script can't.
- **`cli` / `mcp`:** they re-release the bundled engine; their output is unchanged by this release. The tab order from `real-a11y tabs` and `get_tab_order` is the only output they build with the DOM producer, and it prints no states. Everything else they print reads Chromium's own tree, which already reported the state.
