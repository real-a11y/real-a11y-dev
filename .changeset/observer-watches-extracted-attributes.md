---
"@real-a11y-dev/core": patch
---

Fix live state going stale when an app flips an ARIA state attribute in place.

`DomObserver`'s `attributeFilter` restated its own list of attributes instead of tracking the ones the extraction pipeline reads, and had drifted from it. `aria-current`, `aria-busy`, `aria-readonly`, `aria-required`, `aria-controls`, `aria-haspopup`, `name`, `placeholder`, `action`, `method`, and the media attributes (`autoplay`, `muted`, `loop`, `poster`) were recorded on every node but never observed — so an SPA moving `aria-current="page"` between nav links on a route change, or a form toggling `aria-required` / `aria-busy`, produced no re-extraction and the tree kept showing the previous state, with nothing to indicate it was stale. These flip in place on an element that is already in the tree, so there was no childList mutation to fall back on; the change only surfaced if some unrelated observed attribute happened to change too.

Four more attributes are consumed further along the pipeline without being recorded on a node, and were missing for the same reason: `aria-description` and `aria-level` (description and heading level), `scope` (selects a `<th>`'s columnheader/rowheader role), and `autocomplete` — which decides whether a field's value is redacted, so a field turned into a credential field mid-session kept showing its value until something else forced a re-extraction.

The filter is now the union of the extractor's own attribute lists and the ones only the observer needs, so the recorded-attribute half can't drift again.
