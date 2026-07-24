---
"@real-a11y-dev/testing": minor
---

`attach(page, { tree: "native" })` — audit a Playwright page against Chromium's **native** accessibility tree.

The default (`tree: "dom"`, unchanged) injects the page-bundle and walks the light DOM in-page. The new `"native"` mode instead reads Chromium's own accessibility tree over CDP (`@real-a11y-dev/browser`'s `nativeTree`) and runs the same serialize/audit helpers in Node — so it reaches structure no in-page walk can, most visibly a `<video controls>`'s play/scrubber/mute controls, which live in a closed user-agent shadow root. The handle shape is identical: `auditSnapshot`, `outlineSnapshot`, and every `assert*` method work the same way.

Native mode is **read-only and whole-document** for now: `tabSequenceSnapshot()` throws (a native tree carries no focus/interaction data), and `rootSelector` scoping is rejected up front (omit it to audit the whole document). Both throw with an explanatory message rather than returning something misleading.
