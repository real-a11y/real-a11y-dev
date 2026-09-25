---
"@real-a11y-dev/inspector": minor
"@real-a11y-dev/react": minor
---

`onAction` now reports the dispatcher's real `ActionResult` instead of a fabricated `{ success: true }`.

`createInspector({ onAction })` and `<SemanticNavigator onAction>` have always been typed `(request, result) => void`, but the result was manufactured at the call site: the panel discarded what `ActionDispatcher.dispatch()` returned and reported success unconditionally. A click on a row whose element had left the DOM, a `type` on an element that accepts no text input, or a page handler that threw mid-dispatch — all of them were announced to the consumer as successes. The dispatcher's own result (`{ success: false, error: "Element is disconnected from the document" }` and friends) now reaches the callback, so the values match the signature the docs already describe.

**Breaking change:** a handler that assumed `result.success` was always `true` will start seeing `false` with an `error` string on actions that genuinely fail. Migration: branch on `result.success` and read `result.error` — the failure was already happening, it just wasn't reported.

One pre-existing gap this makes visible, worth knowing before you wire the failure branch to a toast: the panel's row button dispatches `{ nodeId, action }` with no payload, so on a text field or a `<select>` the `Type` / `Select` button reports `{ success: false, error: "No value provided for type action" }` **every time**. That action has never actually changed the page from this panel — the panel has no prompt to collect a value — and now it says so instead of claiming success. Treat those two as "not supported from the panel yet" rather than as intermittent failures.

Unchanged: `onAction` still fires once per dispatched action, and the gated paths (`interactive: false`, and `focus`/`increment`/`decrement` under `focusHostOnActivate: false`) still return before dispatch without invoking it.
