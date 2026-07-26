---
"@real-a11y-dev/browser": patch
---

`CdpActionBackend`: fix three cases where an action reported success but the page never reacted. The CDP write path was implemented independently of the in-page dispatcher `@real-a11y-dev/core` has used for a while in the extension and Storybook panel, and it was missing the hardening that dispatcher earned from real pages. Because a swallowed action still returns `{ success: true }`, the failure was silent: the MCP `click_element` / `type_text` tools reported success and the follow-up `diff_tree` read "(no changes)", which an agent takes as "the click did nothing" rather than "the click missed".

- **click** dispatched `element.click()`, which fires `click` alone. Handlers that gate on a pointer sequence (jsaction, Material ripple) never ran. It now fires the full `pointerdown → mousedown → pointerup → mouseup → click`.
- **click on a composite-widget wrapper** (`treeitem`, `menuitem`, `option`, `tab`, `row`, `gridcell`, `cell`) landed on the wrapper, so a delegated `event.target.closest(…)` handler walked upward, away from the descendant that owns the behavior, and no-op'd. The click is now redirected to that descendant, matching core.
- **type into a contenteditable** wrote `textContent` unconditionally. Model-driven editors (ProseMirror, Lexical, Draft) insert into their own document model from `beforeinput` and then re-render, reverting the write — so the text landed and vanished. It now fires a cancelable `beforeinput` first and writes only when nothing handled it.

`focus` also stops reporting `<input type="image">` (and any input type added in future) as a text field: the text-entry check was a deny-list and is now the same allow-list core uses.

The code that runs in the page moves to `src/page-actions.ts`, serialized to CDP as source text — which is why those functions are written self-contained rather than sharing helpers. Parity tests run them and core's `ActionDispatcher` over identical fixtures and compare the observable result, so the two can't drift apart unnoticed. Two divergences are deliberate and documented: failures never carry page text (R1), and `focus` reports the field's real `type` where core always says `"text"`.
