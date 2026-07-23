---
"@real-a11y-dev/browser": minor
---

Add the **native accessibility-tree producer**: `browser.nativeTree()` reads Chromium's own tree over CDP (`Accessibility.getFullAXTree`) and normalizes it into the same `ExtractionResult` model the DOM producer emits, stamped `source.producer === "native"`. This is the second producer from the native-tree RFC (#197) — one canonical model, two producers.

It surfaces structure no in-page walk can reach, most visibly a `<video controls>`'s user-agent-shadow controls (play, scrubber, mute). Vocabulary (which nodes survive, sibling order, role map, name promotion) comes from core's shared `normalizeNativeAX`, so `serialize` / `audit` / diff treat native and DOM trees identically.

- New API: `BrowserSession.nativeTree(): Promise<ExtractionResult>` (added to the `A11ySession` interface), plus the standalone `nativeTree(page)` and the pure, unit-testable `buildNativeTree(rawNodes, enrichment?, chrome?)`.
- **Read-only (Phase 1):** every node carries `a11y`, and a `dom` facet when a DOM node backs it; there is deliberately **no `interaction` facet** — CDP action dispatch is a later phase, and a read-only tree lies less by omitting it.
- **Redaction is enforced by construction (RFC finding R1):** the producer never reads any element's live `.value`, drops the AX `value` field, and the `dom` facet copies only an allowlist of structural / accessibility attributes (never `value`). Proven by a test that builds the tree from a real recorded payload carrying real email/password secrets and asserts they appear nowhere in the output.
- Enrichment is a single batched `DOM.getDocument` walk (RFC finding R3), not per-node round-trips.
