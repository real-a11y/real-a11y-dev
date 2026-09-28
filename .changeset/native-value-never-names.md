---
---

No npm release. Core's native normalizer no longer copies a node's value into its name. That applies to what is typed into a `<div role="application" contenteditable>`, a `role="document"` or `role="log"` editor, or a contenteditable `<p>`, and to the fallback text inside a `role="progressbar"`. `@real-a11y-dev/browser` used to strip that name itself, after normalizing. It now takes names from core as they are, so `real-a11y tree`, `audit`, the MCP tools and `testing`'s native producer print exactly what they printed before.

The one surface whose output changes is the Chrome extension's native mode, which never had the strip. It gets a `packages/extension/CHANGELOG.md` entry instead, since changesets ignores the extension. `NATIVE_AX_VOCABULARY_VERSION` goes to 6.
