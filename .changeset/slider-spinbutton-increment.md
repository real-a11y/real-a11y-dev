---
"@real-a11y-dev/core": minor
"@real-a11y-dev/semantic-navigator-ui": patch
---

Add increment/decrement actions for slider and spinbutton rows. The panel
previously labelled ARIA `[role="slider"]` and `[role="spinbutton"]` as
TYPE — but typing into a Radix Slider (a `<span role="slider">` that
listens for arrow keys, not value setters) silently did nothing. Now:

- `ActionType` gains `"increment"` and `"decrement"` (additive, hence the
  minor bump on `@real-a11y-dev/core`).
- The dispatcher routes both to a single stepper:
  - Native `<input type="range" | "number">` → `.stepUp()` / `.stepDown()`
    - `input`/`change` events (so frameworks observe the change).
  - Custom ARIA widgets (Radix, Headless UI, etc.) → focus the element +
    dispatch `ArrowRight` / `ArrowLeft` `keydown`+`keyup`. Works under
    the Screen Curtain because the panel drives the value change
    end-to-end without relying on the user seeing the page.
- `getActions` now exposes:
  - `[role="slider"]` → `focus`, `increment`, `decrement` (drops misleading
    `type`).
  - `[role="spinbutton"]` → `focus`, `type`, `increment`, `decrement`
    (spinbuttons accept typed values too).
  - `<input type="range">` → `focus`, `increment`, `decrement`.
  - `<input type="number">` → `focus`, `type`, `increment`, `decrement`.
- `TreeNode` renders a paired ▼ ▲ stepper instead of a single primary
  button when both actions are present. Each button dispatches its own
  action via the new optional `action` parameter on `onActivate`.
