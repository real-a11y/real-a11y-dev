---
"@real-a11y-dev/mcp": minor
---

`audit_page` and `inspect_page` accept `producer: "native"` — audit Chromium's own accessibility tree.

The default (`producer: "dom"`, unchanged) walks the page's light DOM. Passing `producer: "native"` runs the same audit over **Chromium's own accessibility tree** (read over CDP via `@real-a11y-dev/browser`'s `nativeTree`, serialized + audited in Node through `@real-a11y-dev/snapshot`'s `projectNativeTree`) — so it reaches structure no in-page walk can, most visibly a `<video controls>`'s play/scrubber/mute controls, which live in a closed user-agent shadow root. This is the difference between _viewing_ the native tree (`get_native_tree`, unchanged) and _auditing_ it.

Native is whole-document and read-only: `rootSelector` must stay `"body"` (any other value is refused, since native can't scope), and a native tree carries no tab order — so `inspect_page`'s tab-order section reports N/A rather than an empty block. Chromium only.
