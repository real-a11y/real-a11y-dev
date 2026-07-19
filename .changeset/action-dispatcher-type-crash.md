---
"@real-a11y-dev/core": patch
---

ActionDispatcher: fix an uncaught `TypeError` when the `type` action targets a custom ARIA textbox/searchbox/spinbutton. The extractor assigns `type` to those roles, which in real apps are usually contenteditable `<div>`/`<span>`s (ProseMirror, Lexical, the Slack composer, custom date steppers) — but `handleType` unconditionally called the native `HTMLInputElement` value setter, whose brand check throws `"Illegal invocation"` on a non-input, and `dispatch()` had no try/catch so it escaped the caller (in the extension it blew out of the content-script message handler and hung the panel's action).

Now `handleType` guards the native-setter path with `instanceof`, drives contenteditable custom textboxes via the platform insertion sequence (a cancelable `beforeinput` so model-driven editors like ProseMirror/Lexical insert into their own document model, falling back to writing `textContent` + `input` only when nothing handles it), returns a failed result for elements that accept no text input, and `dispatch()` wraps every handler so any synchronous throw becomes `{ success: false, error }` instead of propagating.
