---
"@real-a11y-dev/core": patch
---

Stop the element picker from activating the widget you were trying to inspect. `createPicker` intercepted only `click`, so while pick mode was on the rest of the pointer sequence still reached the page: Radix and Headless UI dropdowns open on `pointerdown`, focus moves on `mousedown`, Material ripples start on `pointerdown`. Clicking a menu button to inspect it opened the menu — the click was cancelled, but everything leading up to it had already fired.

Pick mode now suppresses `pointerdown`, `mousedown`, `pointerup`, `mouseup`, and `auxclick` at the capture phase (`preventDefault` + `stopPropagation`) for as long as it is enabled, the way Chrome's own inspect mode swallows the whole sequence. `click` is unchanged — it is still what resolves the pick and exits the mode — and all the added listeners come off with the rest on disable or `teardown()`.
